// Заглушка вопроса, вставленного в текст урока (заход B.1, край 2.3).
//
// Живёт рядом с рендером, а не с интерактивным вопросом: сам вопрос
// (components/features/quiz/inline-question.tsx) тянет LessonRenderer, и импорт
// его отсюда замкнул бы цикл модулей.

import type { InlineQuestionProblem } from "@/lib/content/inline-questions";

/**
 * Директива осталась, а вопроса нет: удаление вопроса из банка каскадно уносит
 * `question_lessons`, но текст урока не трогает. Ученику — спокойная строка
 * вместо пустоты или ошибки рендера.
 */
export function InlineQuestionUnavailable({ reason }: { reason: InlineQuestionProblem }) {
  const text =
    reason === "not_closed"
      ? "Этот вопрос без вариантов ответа — пройти его прямо в тексте нельзя."
      : "Вопрос больше недоступен — его убрали из банка.";
  return (
    <aside className="rounded-card border-border bg-surface-1 text-text-3 my-5 border border-dashed px-4 py-3 text-[13px]">
      {text}
    </aside>
  );
}
