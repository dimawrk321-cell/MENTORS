// Фильтр программы курса (заход B.5, референс v2): «Все / Не пройдены / Видео».
//
// Живёт в utils, а не в клиентском островке, по правилу проекта: чистая часть —
// под тестами (jsdom в проекте нет, поэтому проверяемое выносится из DOM).
// Тип описан структурно, а не импортом `ModuleTreeModule`: утилита не должна
// зависеть от компонента, но обязана подходить ему без приведения.

export type LessonFilter = "all" | "todo" | "video";

interface FilterableLesson {
  completed: boolean;
  hasVideo: boolean;
}

interface FilterableTest {
  passed: boolean;
}

/**
 * Модульный тест — не урок: в «Не пройдены» он остаётся, пока не сдан (это тоже
 * незакрытый шаг модуля), а из «Видео» уходит всегда. Модуль показывается, если
 * после фильтра в нём остался хотя бы урок или тест.
 */
export function applyLessonFilter<
  L extends FilterableLesson,
  T extends FilterableTest,
  M extends { lessons: L[]; test?: T },
>(modules: M[], filter: LessonFilter): M[] {
  if (filter === "all") return modules;
  return modules
    .map((module) => ({
      ...module,
      lessons: module.lessons.filter((lesson) =>
        filter === "todo" ? !lesson.completed : lesson.hasVideo,
      ),
      test: filter === "todo" && module.test && !module.test.passed ? module.test : undefined,
    }))
    .filter((module) => module.lessons.length > 0 || module.test);
}
