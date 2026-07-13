import type { CourseGating, Track } from "@prisma/client";
import type { Db } from "@/lib/db";
import { emitEvent } from "@/lib/services/events";
import { addSrsCardsForLessonCompletion } from "@/lib/services/srs";
import {
  getModuleTestStates,
  makeModuleTestHook,
  type ModuleTestState,
} from "@/lib/services/tests";

// Student-facing content domain (spec 7.3): course/module/lesson reading model,
// gating, reading positions, completion, content reports. The admin studio
// lives in content-admin.ts.

// --- Pure gating core (unit-tested) ---

export interface GatingLessonInput {
  id: string;
  isOptional: boolean;
  contentUpdatedAt: Date;
}

export interface GatingModuleInput {
  id: string;
  lessons: GatingLessonInput[]; // published only, in display order
}

export interface ProgressInput {
  status: "in_progress" | "completed";
  completedAt: Date | null;
}

export interface LessonState {
  unlocked: boolean;
  completed: boolean;
  started: boolean;
  /** «Урок обновлён» (spec 7.3): content changed after this user completed it. */
  updatedSinceCompletion: boolean;
  current: boolean;
}

export interface ModuleState {
  /** All required lessons completed (module test joins the condition at stage 3). */
  closed: boolean;
  reachable: boolean;
  completedRequired: number;
  totalRequired: number;
}

export type UnlockReason =
  | { kind: "lesson"; id: string; title: string }
  | { kind: "module_test"; moduleId: string; moduleTitle: string };

export interface CourseState {
  lessons: Map<string, LessonState>;
  modules: Map<string, ModuleState>;
  /** First unlocked, not yet completed lesson in course order. */
  nextLessonId: string | null;
  completedRequired: number;
  totalRequired: number;
}

export function isLessonUpdatedSinceCompletion(
  completedAt: Date | null,
  contentUpdatedAt: Date,
): boolean {
  return completedAt !== null && contentUpdatedAt > completedAt;
}

/**
 * Gating (spec 7.3):
 * - strict: a lesson opens when every preceding REQUIRED lesson of its module
 *   is completed and every previous module is closed. Optional lessons never
 *   block anything, but obey the same unlock slot as their position.
 * - recommended | free: everything is open; the «current» dot still highlights
 *   the suggested order.
 * Module close = all required lessons completed. The module-test condition and
 * test-out arrive at stage 3 via `isModuleTestPassed` (defaults to passed —
 * no tests exist yet, so no lock screens mention them anywhere).
 */
export function computeCourseState(
  gating: CourseGating,
  modules: GatingModuleInput[],
  progress: Map<string, ProgressInput>,
  isModuleTestPassed: (moduleId: string) => boolean = () => true,
): CourseState {
  const lessons = new Map<string, LessonState>();
  const moduleStates = new Map<string, ModuleState>();

  let previousModulesClosed = true;
  let courseCompletedRequired = 0;
  let courseTotalRequired = 0;

  for (const mod of modules) {
    const required = mod.lessons.filter((lesson) => !lesson.isOptional);
    const completedRequired = required.filter(
      (lesson) => progress.get(lesson.id)?.status === "completed",
    ).length;
    const closed = completedRequired === required.length && isModuleTestPassed(mod.id);
    const reachable = previousModulesClosed;

    courseCompletedRequired += completedRequired;
    courseTotalRequired += required.length;

    let precedingRequiredCompleted = true;
    for (const lesson of mod.lessons) {
      const lessonProgress = progress.get(lesson.id);
      const completed = lessonProgress?.status === "completed";
      const unlocked = gating === "strict" ? reachable && precedingRequiredCompleted : true;

      lessons.set(lesson.id, {
        unlocked,
        completed,
        started: lessonProgress !== undefined,
        updatedSinceCompletion: isLessonUpdatedSinceCompletion(
          lessonProgress?.completedAt ?? null,
          lesson.contentUpdatedAt,
        ),
        current: false, // filled below
      });

      if (!lesson.isOptional && !completed) {
        precedingRequiredCompleted = false;
      }
    }

    moduleStates.set(mod.id, {
      closed,
      reachable,
      completedRequired,
      totalRequired: required.length,
    });
    previousModulesClosed = previousModulesClosed && closed;
  }

  let nextLessonId: string | null = null;
  for (const mod of modules) {
    for (const lesson of mod.lessons) {
      const state = lessons.get(lesson.id)!;
      if (state.unlocked && !state.completed) {
        nextLessonId = lesson.id;
        break;
      }
    }
    if (nextLessonId) break;
  }
  if (nextLessonId) {
    const current = lessons.get(nextLessonId)!;
    lessons.set(nextLessonId, { ...current, current: true });
  }

  return {
    lessons,
    modules: moduleStates,
    nextLessonId,
    completedRequired: courseCompletedRequired,
    totalRequired: courseTotalRequired,
  };
}

// --- Queries ---

const publishedLessonsArg = {
  where: { status: "published" as const },
  orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
};

const publishedModulesArg = {
  where: { status: "published" as const },
  orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
  include: { lessons: publishedLessonsArg },
};

async function getProgressMap(db: Db, userId: string, lessonIds: string[]) {
  const rows = await db.lessonProgress.findMany({
    where: { userId, lessonId: { in: lessonIds } },
  });
  return new Map<string, ProgressInput & { scrollPos: number | null; videoPos: number | null }>(
    rows.map((row) => [
      row.lessonId,
      {
        status: row.status,
        completedAt: row.completedAt,
        scrollPos: row.scrollPos,
        videoPos: row.videoPos,
      },
    ]),
  );
}

/** Track-aware course ordering (spec 8.3): track courses first, then the rest. */
export async function listCoursesForStudent(db: Db, userId: string, track: Track | null) {
  const courses = await db.course.findMany({
    where: { status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { modules: publishedModulesArg },
  });

  let ordered = courses;
  if (track) {
    const trackDef = await db.trackDef.findUnique({ where: { key: track } });
    const trackOrder = (trackDef?.courseIds as string[] | undefined) ?? [];
    const rank = new Map(trackOrder.map((id, index) => [id, index]));
    ordered = [...courses].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.order - b.order;
    });
  }

  const allLessonIds = ordered.flatMap((course) =>
    course.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
  );
  const progress = await getProgressMap(db, userId, allLessonIds);
  const allModuleIds = ordered.flatMap((course) => course.modules.map((m) => m.id));
  const testStates = await getModuleTestStates(db, userId, allModuleIds);
  const testHook = makeModuleTestHook(testStates);

  return ordered.map((course) => {
    const state = computeCourseState(course.gating, course.modules, progress, testHook);
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      gating: course.gating,
      lessonsTotal: state.totalRequired,
      lessonsCompleted: state.completedRequired,
      progressPct:
        state.totalRequired === 0
          ? 0
          : Math.round((state.completedRequired / state.totalRequired) * 100),
    };
  });
}

export async function getCourseView(db: Db, slug: string, userId: string) {
  const course = await db.course.findUnique({
    where: { slug },
    include: { modules: publishedModulesArg },
  });
  if (!course || course.status !== "published") return null;

  const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const progress = await getProgressMap(db, userId, lessonIds);
  // Spec 7.3: закрытие модуля учитывает сданный модульный тест (если включён).
  const testStates = await getModuleTestStates(
    db,
    userId,
    course.modules.map((m) => m.id),
  );
  const state = computeCourseState(
    course.gating,
    course.modules,
    progress,
    makeModuleTestHook(testStates),
  );

  return { course, state, testStates };
}

export type CourseTestStates = Map<string, ModuleTestState>;

export interface LessonView {
  lesson: {
    id: string;
    title: string;
    contentMd: string;
    readingMinutes: number;
    difficulty: "intro" | "base" | "advanced";
    isOptional: boolean;
    videoUrl: string | null;
    videoStatus: "ok" | "unavailable" | "unchecked";
  };
  course: { id: string; slug: string; title: string; gating: CourseGating };
  module: { id: string; title: string };
  state: LessonState;
  unlocked: boolean;
  /** For the lock screen: the step that opens this lesson (spec 8.3). */
  unlockReason: UnlockReason | null;
  prev: { id: string; title: string; unlocked: boolean } | null;
  next: { id: string; title: string; unlocked: boolean } | null;
  progress: { scrollPos: number | null; videoPos: number | null; completedAt: Date | null };
}

export async function getLessonView(
  db: Db,
  lessonId: string,
  userId: string,
): Promise<LessonView | null> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { include: { course: true } } },
  });
  if (
    !lesson ||
    lesson.status !== "published" ||
    lesson.module.status !== "published" ||
    lesson.module.course.status !== "published"
  ) {
    return null;
  }
  const course = lesson.module.course;

  const courseView = await getCourseView(db, course.slug, userId);
  if (!courseView) return null;
  const { state } = courseView;

  const flat = courseView.course.modules.flatMap((module) =>
    module.lessons.map((l) => ({ id: l.id, title: l.title })),
  );
  const index = flat.findIndex((l) => l.id === lesson.id);
  const prevMeta = index > 0 ? flat[index - 1] : null;
  const nextMeta = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;

  const lessonState = state.lessons.get(lesson.id) ?? {
    unlocked: false,
    completed: false,
    started: false,
    updatedSinceCompletion: false,
    current: false,
  };

  // Lock hint (spec 8.3): the first not-completed required lesson before this
  // one, or — когда уроки предыдущего модуля пройдены — его несданный
  // модульный тест (замок «Откроется после модульного теста» только у модулей
  // с enabled-тестом: hook возвращает false ровно в этом случае).
  let unlockReason: UnlockReason | null = null;
  if (!lessonState.unlocked) {
    for (const mod of courseView.course.modules) {
      const isOwnModule = mod.id === lesson.moduleId;
      for (const candidate of mod.lessons) {
        if (isOwnModule && candidate.id === lesson.id) break;
        const candidateState = state.lessons.get(candidate.id);
        if (!candidate.isOptional && !candidateState?.completed) {
          unlockReason = { kind: "lesson", id: candidate.id, title: candidate.title };
          break;
        }
      }
      if (unlockReason || isOwnModule) break;
      const moduleState = state.modules.get(mod.id);
      if (moduleState && !moduleState.closed) {
        // All required lessons of the previous module are done → the blocker
        // is its enabled, unpassed test.
        unlockReason = { kind: "module_test", moduleId: mod.id, moduleTitle: mod.title };
        break;
      }
    }
  }

  const progressRow = await db.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId: lesson.id } },
  });

  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      contentMd: lesson.contentMd,
      readingMinutes: lesson.readingMinutes,
      difficulty: lesson.difficulty,
      isOptional: lesson.isOptional,
      videoUrl: lesson.videoUrl,
      videoStatus: lesson.videoStatus,
    },
    course: { id: course.id, slug: course.slug, title: course.title, gating: course.gating },
    module: { id: lesson.module.id, title: lesson.module.title },
    state: lessonState,
    unlocked: lessonState.unlocked,
    unlockReason,
    prev: prevMeta
      ? { ...prevMeta, unlocked: state.lessons.get(prevMeta.id)?.unlocked ?? false }
      : null,
    next: nextMeta
      ? { ...nextMeta, unlocked: state.lessons.get(nextMeta.id)?.unlocked ?? false }
      : null,
    progress: {
      scrollPos: progressRow?.scrollPos ?? null,
      videoPos: progressRow?.videoPos ?? null,
      completedAt: progressRow?.completedAt ?? null,
    },
  };
}

// --- Student mutations ---

/** First open of a lesson creates the in_progress row and emits lesson.started. */
export async function startLesson(
  db: Db,
  input: { userId: string; lessonId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const existing = await db.lessonProgress.findUnique({
    where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
    select: { id: true },
  });
  if (existing) return;
  await db.lessonProgress.create({
    data: { userId: input.userId, lessonId: input.lessonId, status: "in_progress", createdAt: now },
  });
  await emitEvent(db, "lesson.started", { lessonId: input.lessonId }, { userId: input.userId });
}

export type CompleteLessonResult =
  | { ok: true; nextLessonId: string | null; courseSlug: string }
  | { ok: false; code: "not_found" | "locked" };

/** Explicit, idempotent completion (spec 7.3); returns the next open lesson. */
export async function completeLesson(
  db: Db,
  input: { userId: string; lessonId: string; now?: Date },
): Promise<CompleteLessonResult> {
  const now = input.now ?? new Date();
  const view = await getLessonView(db, input.lessonId, input.userId);
  if (!view) return { ok: false, code: "not_found" };
  if (!view.unlocked) return { ok: false, code: "locked" };

  if (view.progress.completedAt === null) {
    await db.lessonProgress.upsert({
      where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
      create: {
        userId: input.userId,
        lessonId: input.lessonId,
        status: "completed",
        completedAt: now,
        createdAt: now,
      },
      update: { status: "completed", completedAt: now },
    });
    await emitEvent(
      db,
      "lesson.completed",
      { lessonId: input.lessonId, moduleId: view.module.id, courseId: view.course.id },
      { userId: input.userId },
    );
    // Spec 7.6: завершение урока заводит карточки всех is_key-вопросов. Внутри
    // идемпотентной ветки — повторное нажатие «Завершить» карточки не трогает.
    await addSrsCardsForLessonCompletion(db, {
      userId: input.userId,
      lessonId: input.lessonId,
      now,
    });
  }

  // Recompute after the write — the completion may have opened the next slot.
  const courseView = await getCourseView(db, view.course.slug, input.userId);
  return {
    ok: true,
    nextLessonId: courseView?.state.nextLessonId ?? null,
    courseSlug: view.course.slug,
  };
}

/** Debounced reading positions (spec 7.3): scroll fraction + video seconds. */
export async function savePosition(
  db: Db,
  input: { userId: string; lessonId: string; scrollPos?: number | null; videoPos?: number | null },
): Promise<void> {
  const scroll =
    input.scrollPos === undefined || input.scrollPos === null
      ? undefined
      : Math.max(0, Math.min(1, input.scrollPos));
  const video =
    input.videoPos === undefined || input.videoPos === null
      ? undefined
      : Math.max(0, Math.floor(input.videoPos));

  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
    create: {
      userId: input.userId,
      lessonId: input.lessonId,
      status: "in_progress",
      scrollPos: scroll ?? null,
      videoPos: video ?? null,
    },
    update: {
      ...(scroll !== undefined ? { scrollPos: scroll } : {}),
      ...(video !== undefined ? { videoPos: video } : {}),
    },
  });
}

/** «⚑ Нашёл ошибку / непонятно» → content_reports (spec 7.3). */
export async function reportContent(
  db: Db,
  input: {
    userId: string;
    lessonId?: string;
    questionId?: string;
    blockAnchor?: string;
    type: "error" | "unclear";
    text?: string;
  },
): Promise<{ id: string }> {
  const report = await db.contentReport.create({
    data: {
      userId: input.userId,
      lessonId: input.lessonId ?? null,
      questionId: input.questionId ?? null,
      blockAnchor: input.blockAnchor ?? null,
      type: input.type,
      text: input.text?.trim() || null,
    },
  });
  await emitEvent(
    db,
    "report.created",
    { reportId: report.id, lessonId: input.lessonId ?? null, type: input.type },
    { userId: input.userId },
  );
  return { id: report.id };
}

// --- Onboarding (spec 8.2) ---

export async function saveOnboarding(
  db: Db,
  input: {
    userId: string;
    track: Track | null;
    dailyGoalXp: 30 | 60 | 120;
    digestTime: string;
  },
): Promise<void> {
  await db.user.update({
    where: { id: input.userId },
    data: {
      ...(input.track ? { track: input.track } : {}),
      dailyGoalXp: input.dailyGoalXp,
      digestTime: input.digestTime,
    },
  });
}

/** «Начать обучение» → первый урок трека (spec 8.2). */
export async function getFirstLessonOfTrack(db: Db, track: Track | null): Promise<string | null> {
  let courseIds: string[] = [];
  if (track) {
    const trackDef = await db.trackDef.findUnique({ where: { key: track } });
    courseIds = (trackDef?.courseIds as string[] | undefined) ?? [];
  }

  const candidates = await db.course.findMany({
    where: { status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { modules: publishedModulesArg },
  });
  const rank = new Map(courseIds.map((id, index) => [id, index]));
  const ordered = [...candidates].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a.order - b.order;
  });

  for (const course of ordered) {
    for (const mod of course.modules) {
      const first = mod.lessons[0];
      if (first) return first.id;
    }
  }
  return null;
}
