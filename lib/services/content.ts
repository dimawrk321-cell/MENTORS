import type {
  CourseGating,
  LessonPathPolicy,
  LessonPathSelection,
  PrismaClient,
  Track,
} from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  computeCourseState,
  type LessonState,
  type ProgressInput,
  type UnlockReason,
} from "@/lib/services/gating";
import { emitEvent, type EarnedAchievement, type EmitResult } from "@/lib/services/events";
import { writeAudit } from "@/lib/services/audit";
import { markRecommendedPath } from "@/lib/services/course-order";
import { addSrsCardsForLessonCompletion } from "@/lib/services/srs";
import {
  canOpenCourse,
  isCourseComplete,
  isOpen,
  listCourseAccess,
  unlockNextAfter,
} from "@/lib/services/course-access";
import { notify } from "@/lib/services/notifications";
import {
  getModuleTestStates,
  makeModuleTestHook,
  type ModuleTestState,
} from "@/lib/services/tests";

// Student-facing content domain (spec 7.3): course/module/lesson reading model,
// gating, reading positions, completion, content reports. The admin studio
// lives in content-admin.ts.

// Чистое ядро гейтинга живёт в отдельном листе (см. gating.ts) и реэкспортируется
// отсюда: у content.ts остаётся прежний публичный контракт.
export * from "@/lib/services/gating";

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
  return new Map<
    string,
    ProgressInput & {
      scrollPos: number | null;
      videoPos: number | null;
      selectedPath: LessonPathSelection | null;
    }
  >(
    rows.map((row) => [
      row.lessonId,
      {
        status: row.status,
        completedAt: row.completedAt,
        scrollPos: row.scrollPos,
        videoPos: row.videoPos,
        selectedPath: row.selectedPath,
      },
    ]),
  );
}

/** The catalog as the student sees it: chain order + per-course access state. */
export async function listCoursesForStudent(db: Db, userId: string) {
  const courses = await db.course.findMany({
    where: { status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { modules: publishedModulesArg },
  });

  // Block 2v2: ONE global chain by `order` — tracks no longer reorder anything
  // (they stayed a label). Access state rides along so the catalog can draw locks.
  const access = await listCourseAccess(db, userId);
  const accessByCourse = new Map(access.map((row) => [row.courseId, row]));
  const ordered = [...courses].sort(
    (a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const allLessonIds = ordered.flatMap((course) =>
    course.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
  );
  const progress = await getProgressMap(db, userId, allLessonIds);
  const allModuleIds = ordered.flatMap((course) => course.modules.map((m) => m.id));
  const testStates = await getModuleTestStates(db, userId, allModuleIds);
  const testHook = makeModuleTestHook(testStates);

  // markRecommendedPath keeps «Начни отсюда» and the completed check ON TOP of
  // the chain (block 2v2.6): «next» is the first OPEN course still unfinished,
  // so it never points at a locked card.
  const rows = markRecommendedPath(
    ordered.map((course) => {
      const state = computeCourseState(course.gating, course.modules, progress, testHook);
      const accessRow = accessByCourse.get(course.id);
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
        accessState: accessRow?.state ?? "locked_chain",
        unlocksAfter: accessRow?.unlocksAfter ?? null,
        locked: !isOpen(accessRow?.state ?? "locked_chain"),
        // The «пройден» tick uses the CHAIN's completion rule, not a lesson
        // count. They disagree exactly when a course ends in an enabled unpassed
        // module test — and the catalog was rendering the green check next to
        // «Откроется после {этот курс}» on the same screen (audit finding).
        isCompleted: isCourseComplete(state.modules, state.totalRequired),
      };
    }),
  );
  // A locked course must never be the «Начни отсюда» target.
  let nextTaken = false;
  return rows.map((row) => {
    const isNext = !row.locked && !row.isCompleted && !nextTaken;
    if (isNext) nextTaken = true;
    return { ...row, isNext };
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
    pathPolicy: LessonPathPolicy;
    textMinutes: number | null;
    videoMinutes: number | null;
    practiceMinutes: number | null;
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
  progress: {
    scrollPos: number | null;
    videoPos: number | null;
    selectedPath: LessonPathSelection | null;
    completedAt: Date | null;
  };
  lessonSteps: {
    id: string;
    title: string;
    order: number;
    contentMd: string;
    readingMinutes: number;
    completedAt: Date | null;
    scrollPos: number | null;
  }[];
  /**
   * Позиция урока в СВОЁМ модуле для шапки «Урок X из Y» и сегментированного
   * индикатора («Читалка v2»). Чистое представление — уже вычисленное состояние
   * гейтинга (`computeCourseState`), никакой новой логики доступа.
   */
  position: {
    index: number;
    total: number;
    steps: { id: string; completed: boolean; unlocked: boolean; current: boolean }[];
  };
}

export async function getLessonView(
  db: Db,
  lessonId: string,
  userId: string,
): Promise<LessonView | null> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: { include: { course: true } },
      steps: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
    },
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
  const stepProgress = lesson.steps.length
    ? await db.lessonStepProgress.findMany({
        where: { userId, stepId: { in: lesson.steps.map((step) => step.id) } },
      })
    : [];
  const stepProgressById = new Map(stepProgress.map((progress) => [progress.stepId, progress]));

  // «Урок X из Y» считается по модулю, а не по курсу: модуль — это глава, и его
  // 1–14 уроков ложатся в сегментированный индикатор, тогда как курс целиком
  // (до 40 уроков) в него не помещается.
  const ownModule = courseView.course.modules.find((m) => m.id === lesson.moduleId);
  const moduleLessons = ownModule?.lessons ?? [];
  const steps = moduleLessons.map((l) => {
    const s = state.lessons.get(l.id);
    return {
      id: l.id,
      completed: s?.completed ?? false,
      unlocked: s?.unlocked ?? false,
      current: l.id === lesson.id,
    };
  });

  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      contentMd: lesson.contentMd,
      readingMinutes: lesson.readingMinutes,
      pathPolicy: lesson.pathPolicy,
      textMinutes: lesson.textMinutes,
      videoMinutes: lesson.videoMinutes,
      practiceMinutes: lesson.practiceMinutes,
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
      selectedPath: progressRow?.selectedPath ?? null,
      completedAt: progressRow?.completedAt ?? null,
    },
    lessonSteps: lesson.steps.map((step) => ({
      id: step.id,
      title: step.title,
      order: step.order,
      contentMd: step.contentMd,
      readingMinutes: step.readingMinutes,
      completedAt: stepProgressById.get(step.id)?.completedAt ?? progressRow?.completedAt ?? null,
      scrollPos: stepProgressById.get(step.id)?.scrollPos ?? null,
    })),
    position: {
      index: steps.findIndex((s) => s.current) + 1,
      total: steps.length,
      steps,
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
  | {
      ok: true;
      nextLessonId: string | null;
      courseSlug: string;
      /** Название курса, который цепь открыла этим завершением (блок 2v2). */
      unlockedCourseTitle: string | null;
      /** Геймификация завершения — для ритуалов/тостов на странице урока (spec 5.4). */
      xpAwarded: number;
      leveledUpTo: number | null;
      earnedAchievements: EarnedAchievement[];
    }
  | { ok: false; code: "not_found" | "locked" | "course_locked" | "path_required" };

const NO_GAMIFICATION: EmitResult = {
  recorded: true,
  xpAwarded: 0,
  leveledUpTo: null,
  earnedAchievements: [],
  streakCounted: false,
  streakCurrent: 0,
};

/**
 * Block 2v2: a finished course opens the next link of the chain.
 *
 * A module is `closed` only when its required lessons AND its module test are
 * done, so a course's LAST outstanding requirement can be a module test rather
 * than a lesson. That path does not go through completeLesson, so this hook is
 * shared: completeLesson calls it, and so does finishTestAction after a pass.
 * Without the second caller a student who closes a course with its final test
 * is locked out of the rest of the programme with no way to re-trigger it —
 * «Завершить урок» is disabled once the lessons are already complete.
 *
 * Idempotent (unlockCourse is), so replays open nothing and notify nobody twice.
 * Returns the title of the course this call opened, or null.
 */
export async function advanceChainIfCourseComplete(
  db: Db,
  input: { userId: string; courseSlug: string; now?: Date },
): Promise<string | null> {
  const now = input.now ?? new Date();
  const view = await getCourseView(db, input.courseSlug, input.userId);
  if (!view) return null;
  if (!isCourseComplete(view.state.modules, view.state.totalRequired)) return null;

  const opened = await unlockNextAfter(db, {
    userId: input.userId,
    completedCourseId: view.course.id,
    now,
  });
  if (!opened) return null;

  const next = await db.course.findUnique({
    where: { id: opened.id },
    select: { slug: true },
  });
  if (next) {
    await notify(
      db,
      input.userId,
      "course_unlocked",
      { courseSlug: next.slug, courseTitle: opened.title },
      { now },
    );
  }
  return opened.title;
}

/**
 * Re-runs the chain for everyone standing in a course whose module test just
 * changed (block 2v2, audit finding).
 *
 * The chain only ever moves on a live completion event. Disabling a module test
 * can complete a course for students whose last outstanding requirement it was,
 * and none of them can trigger that event any more — «Завершить урок» is
 * disabled on lessons they already finished. So the admin's toggle has to do it.
 *
 * Scoped to students who have progress in the course and idempotent
 * (advanceChainIfCourseComplete is), so a repeat toggle opens nothing twice.
 */
export async function releaseChainAfterTestChange(
  db: PrismaClient,
  moduleId: string,
  now: Date = new Date(),
): Promise<{ advanced: number }> {
  const mod = await db.module.findUnique({
    where: { id: moduleId },
    select: { course: { select: { id: true, slug: true } } },
  });
  if (!mod) return { advanced: 0 };

  const learners = await db.lessonProgress.findMany({
    where: { lesson: { module: { courseId: mod.course.id } } },
    select: { userId: true },
    distinct: ["userId"],
  });

  let advanced = 0;
  for (const learner of learners) {
    const opened = await advanceChainIfCourseComplete(db, {
      userId: learner.userId,
      courseSlug: mod.course.slug,
      now,
    });
    if (opened) advanced += 1;
  }
  return { advanced };
}

/** Explicit, idempotent completion (spec 7.3); returns the next open lesson. */
export async function completeLesson(
  db: PrismaClient,
  input: {
    userId: string;
    lessonId: string;
    now?: Date;
    /**
     * Block 2v2: the course chain is enforced here, not only on the page — a
     * page guard is cosmetic, the action is the real boundary. The ONE caller
     * that opts out is the mock-interview auto-completion (mocks.ts): that is a
     * system action closing a lesson the student earned by sitting the mock,
     * and it must not depend on where their chain currently stands.
     */
    systemAction?: boolean;
  },
): Promise<CompleteLessonResult> {
  const now = input.now ?? new Date();
  const view = await getLessonView(db, input.lessonId, input.userId);
  if (!view) return { ok: false, code: "not_found" };
  if (!view.unlocked) return { ok: false, code: "locked" };
  if (!input.systemAction && !(await canOpenCourse(db, input.userId, view.course.id))) {
    return { ok: false, code: "course_locked" };
  }
  if (
    !input.systemAction &&
    view.progress.completedAt === null &&
    view.lesson.pathPolicy === "choose_one" &&
    view.progress.selectedPath === null
  ) {
    return { ok: false, code: "path_required" };
  }

  let gamification = NO_GAMIFICATION;
  if (view.progress.completedAt === null) {
    // Spec 7.13: завершение, его событие (XP/стрик/достижения) и SRS-карточки —
    // одной транзакцией.
    gamification = await db.$transaction(async (tx) => {
      await tx.lessonProgress.upsert({
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
      const result = await emitEvent(
        tx,
        "lesson.completed",
        { lessonId: input.lessonId, moduleId: view.module.id, courseId: view.course.id },
        { userId: input.userId, now },
      );
      // Spec 7.6: завершение урока заводит карточки всех is_key-вопросов. Внутри
      // идемпотентной ветки — повторное нажатие «Завершить» карточки не трогает.
      await addSrsCardsForLessonCompletion(tx, {
        userId: input.userId,
        lessonId: input.lessonId,
        now,
      });
      return result;
    });
  }

  // Recompute after the write — the completion may have opened the next slot.
  const courseView = await getCourseView(db, view.course.slug, input.userId);
  const unlockedCourseTitle = await advanceChainIfCourseComplete(db, {
    userId: input.userId,
    courseSlug: view.course.slug,
    now,
  });

  return {
    ok: true,
    unlockedCourseTitle,
    nextLessonId: courseView?.state.nextLessonId ?? null,
    courseSlug: view.course.slug,
    xpAwarded: gamification.xpAwarded,
    leveledUpTo: gamification.leveledUpTo,
    earnedAchievements: gamification.earnedAchievements,
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

/** Persist an explicit choice only for a lesson configured as video-or-text. */
export async function selectLearningPath(
  db: Db,
  input: { userId: string; lessonId: string; path: LessonPathSelection },
): Promise<boolean> {
  const view = await getLessonView(db, input.lessonId, input.userId);
  if (!view || !view.unlocked || view.lesson.pathPolicy !== "choose_one") return false;
  if (!(await canOpenCourse(db, input.userId, view.course.id))) return false;
  if (input.path === "video" && !view.lesson.videoUrl) return false;
  if (input.path === "text" && !view.lesson.contentMd.trim()) return false;

  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId: input.userId, lessonId: input.lessonId } },
    create: {
      userId: input.userId,
      lessonId: input.lessonId,
      status: "in_progress",
      selectedPath: input.path,
    },
    update: { selectedPath: input.path },
  });
  return true;
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
    // Walk 12.4: the student sets their own name on onboarding (2–50 chars).
    name: string;
    track: Track | null;
    dailyGoalXp: 30 | 60 | 120;
    digestTime: string;
  },
): Promise<void> {
  await db.user.update({
    where: { id: input.userId },
    data: {
      name: input.name,
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

/**
 * Resolve an open content report from the Пульт widget (spec 8.5). Idempotent —
 * already-resolved reports are a no-op. Audited.
 */
export async function resolveContentReport(
  db: PrismaClient,
  input: { actorId: string; reportId: string },
): Promise<{ ok: boolean }> {
  const report = await db.contentReport.findUnique({ where: { id: input.reportId } });
  if (!report || report.status === "resolved") return { ok: false };
  await db.$transaction(async (tx) => {
    await tx.contentReport.update({
      where: { id: input.reportId },
      data: { status: "resolved", resolvedById: input.actorId },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "content_report.resolved",
      entityType: "content_report",
      entityId: input.reportId,
    });
  });
  return { ok: true };
}
