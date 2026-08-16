// Вопрос из банка внутри текста урока (заход B.1, блок 2).
//
// Директива `:::question{id="…"}` ссылается на вопрос банка по id. Отдельной
// таблицы для этой связи НЕТ: источник правды — сам markdown урока, ровно как у
// `:::mock` (mocks.ts грепает директиву из content_md, чтобы закрыть мок-урок).
// Поэтому и рендер, и серверная проверка ответа читают связь одной и той же
// чистой функцией — разъехаться им негде.

/** `:::question{id="…"}` — id в кавычках или без. */
const QUESTION_DIRECTIVE_RE = /:::question\{[^}]*\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g;

/**
 * Все id вопросов, вставленных в текст директивами, в порядке появления и без
 * повторов. Пустые id отбрасываются (директива-заготовка без выбранного
 * вопроса).
 */
export function extractInlineQuestionIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const match of markdown.matchAll(QUESTION_DIRECTIVE_RE)) {
    const id = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Почему вставленный вопрос не отрисуется ученику (край 2.3). */
export type InlineQuestionProblem = "missing" | "unpublished" | "not_closed" | "no_id";

/** Стоит ли вопрос внутри текста этого урока. */
export function isInlineQuestionOfLesson(markdown: string, questionId: string): boolean {
  return extractInlineQuestionIds(markdown).includes(questionId);
}
