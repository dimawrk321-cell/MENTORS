import type { Db } from "@/lib/db";
import { isCourseComplete } from "@/lib/services/course-access";
import { computeCourseState } from "@/lib/services/gating";
import { getModuleTestStates, makeModuleTestHook } from "@/lib/services/module-test-state";

// «Что ученик уже прошёл» одним запросом — для двухуровневого доступа к банку
// вопросов (заход «Доступ к вопросам», changelog к 7.4/7.6/8.3).
//
// Считает ровно тем же кодом, что и каталог курсов: `computeCourseState` +
// `isCourseComplete` (все модули закрыты = обязательные уроки завершены И
// модульный тест сдан). Дублировать правило «курс пройден» нельзя — оно уже
// один раз разъезжалось между canOpenCourse и listCourseAccess.
//
// Лежит отдельным файлом, а не в content.ts, из-за дерева зависимостей:
// content.ts → srs.ts → question-access.ts, и импорт content.ts отсюда замкнул
// бы цикл. Поэтому используются вынесенные листы gating.ts и
// module-test-state.ts, а не их реэкспорты из content.ts/tests.ts.

export interface CourseCompletion {
  /** Курсы, пройденные ЦЕЛИКОМ (правило цепи: все модули закрыты). */
  completedCourseIds: Set<string>;
  /** Завершённые опубликованные уроки — по курсам. */
  completedLessonIdsByCourse: Map<string, Set<string>>;
}

// Те же аргументы выборки, что у content.ts: опубликованные модули и уроки в
// порядке показа. Продублированы намеренно (см. про цикл выше) — это описание
// выборки, а не правило гейтинга.
const publishedLessonsArg = {
  where: { status: "published" as const },
  orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
};
const publishedModulesArg = {
  where: { status: "published" as const },
  orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }],
  include: { lessons: publishedLessonsArg },
};

export async function getCourseCompletion(db: Db, userId: string): Promise<CourseCompletion> {
  const courses = await db.course.findMany({
    where: { status: "published" },
    include: { modules: publishedModulesArg },
  });

  const lessonIds = courses.flatMap((course) =>
    course.modules.flatMap((m) => m.lessons.map((lesson) => lesson.id)),
  );
  const moduleIds = courses.flatMap((course) => course.modules.map((m) => m.id));

  const [progressRows, testStates] = await Promise.all([
    db.lessonProgress.findMany({
      where: { userId, lessonId: { in: lessonIds } },
      select: { lessonId: true, status: true, completedAt: true },
    }),
    getModuleTestStates(db, userId, moduleIds),
  ]);
  const progress = new Map(progressRows.map((row) => [row.lessonId, row]));
  const testHook = makeModuleTestHook(testStates);

  const completedCourseIds = new Set<string>();
  const completedLessonIdsByCourse = new Map<string, Set<string>>();

  for (const course of courses) {
    const state = computeCourseState(course.gating, course.modules, progress, testHook);
    if (isCourseComplete(state.modules, state.totalRequired)) completedCourseIds.add(course.id);

    const done = new Set<string>();
    for (const courseModule of course.modules) {
      for (const lesson of courseModule.lessons) {
        if (progress.get(lesson.id)?.status === "completed") done.add(lesson.id);
      }
    }
    completedLessonIdsByCourse.set(course.id, done);
  }

  return { completedCourseIds, completedLessonIdsByCourse };
}
