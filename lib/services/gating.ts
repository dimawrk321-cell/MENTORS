import type { CourseGating } from "@prisma/client";

// Чистое ядро гейтинга курса (spec 7.3) — вынесено ИЗ content.ts дословно, без
// единого изменения логики. Причина выноса: тот же расчёт нужен доступу к банку
// вопросов (question-access → course-completion, заход «Доступ к вопросам»), а
// content.ts тянет за собой srs.ts, который сам зависит от question-access, —
// импорт замкнул бы цикл. Ядро чистое и ничего из сервисов не импортирует,
// поэтому живёт отдельным листом дерева зависимостей; content.ts реэкспортирует
// его целиком, и все прежние импорты «@/lib/services/content» продолжают
// работать (в том числе тесты гейтинга).

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
