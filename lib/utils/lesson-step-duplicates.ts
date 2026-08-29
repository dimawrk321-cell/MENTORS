/**
 * Шаг — это КОПИЯ-снимок урока (`copyLessonsAsSteps`), а не ссылка на него.
 * Исходный урок остаётся отдельной строкой модуля, и код за этим не следит:
 * его уводят в черновик руками. Одна забытая публикация — материал у ученика
 * дважды: строкой в программе курса и шагом внутри другого урока.
 *
 * Здесь живёт правило совпадения. Оно намеренно ТОЧНОЕ, а не пороговое:
 *
 * - **по содержимому** — снимок побайтово равен источнику, пока его не правили;
 *   это ловит копию, которой сменили название (ровно случай «Урока 1» на стенде);
 * - **по названию** — `copyLessonsAsSteps` кладёт в шаг `source.title` дословно,
 *   так что название и есть прямой отпечаток механизма, создающего дубли; это
 *   ловит копию, текст которой уже успели поправить.
 *
 * Нечёткое сходство (порог по словарю) сознательно не вводится: порог пришлось бы
 * калибровать, а ментору нельзя объяснить «похоже на 0.82» — обе точные причины
 * называются одной строкой в интерфейсе.
 */

/** `lessonMarkdownForStep` приклеивает видео источника отдельной директивой сверху. */
const LEADING_VIDEO_DIRECTIVE = /^:::video\{[^\n]*\}[ \t]*\r?\n:::[ \t]*(?:\r?\n)*/;

export type StepDuplicateReason = "content" | "title";

export interface DuplicateLessonInput {
  id: string;
  courseId: string;
  title: string;
  contentMd: string;
}

export interface DuplicateStepInput {
  id: string;
  title: string;
  contentMd: string;
  status: string;
  lessonId: string;
  lessonTitle: string;
  lessonStatus: string;
  courseId: string;
}

export interface StepDuplicate {
  /** Опубликованный урок, который дублируется. Его и снимают с публикации. */
  lessonId: string;
  lessonTitle: string;
  stepId: string;
  stepTitle: string;
  /** Урок, внутри которого лежит копия. */
  stepLessonId: string;
  stepLessonTitle: string;
  reason: StepDuplicateReason;
  /** Ученик уже видит материал дважды (а не «увидит после публикации»). */
  visibleTwice: boolean;
}

export function normalizeDuplicateTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

export function normalizeDuplicateContent(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(LEADING_VIDEO_DIRECTIVE, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

export function stepDuplicateReason(
  lesson: { title: string; contentMd: string },
  step: { title: string; contentMd: string },
): StepDuplicateReason | null {
  const lessonContent = normalizeDuplicateContent(lesson.contentMd);
  if (lessonContent && lessonContent === normalizeDuplicateContent(step.contentMd)) {
    return "content";
  }
  const lessonTitle = normalizeDuplicateTitle(lesson.title);
  if (lessonTitle && lessonTitle === normalizeDuplicateTitle(step.title)) return "title";
  return null;
}

/**
 * Сопоставляет опубликованные уроки с шагами ДРУГИХ уроков того же курса.
 * Собственный шаг урока («Материал» после разделения) совпадает с ним всегда —
 * это и есть штатное разделение, а не дубль, поэтому пара «урок ↔ его же шаг»
 * исключается по `lessonId`.
 */
export function matchStepDuplicates(
  lessons: readonly DuplicateLessonInput[],
  steps: readonly DuplicateStepInput[],
): StepDuplicate[] {
  const found: StepDuplicate[] = [];
  for (const lesson of lessons) {
    for (const step of steps) {
      if (step.courseId !== lesson.courseId) continue;
      if (step.lessonId === lesson.id) continue;
      const reason = stepDuplicateReason(lesson, step);
      if (!reason) continue;
      found.push({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        stepId: step.id,
        stepTitle: step.title,
        stepLessonId: step.lessonId,
        stepLessonTitle: step.lessonTitle,
        reason,
        visibleTwice: step.status === "published" && step.lessonStatus === "published",
      });
    }
  }
  return found;
}
