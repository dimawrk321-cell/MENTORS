import type { Question } from "@prisma/client";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { parseOptions } from "@/lib/utils/answers";

/** Строка правильного ответа закрытого вопроса: варианты либо принятые ответы. */
function correctAnswerText(question: Question): string | null {
  if (question.type === "short_text") {
    const accepted = Array.isArray(question.acceptedAnswers)
      ? (question.acceptedAnswers as unknown[]).filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return accepted.length > 0 ? accepted.join("; ") : null;
  }
  const correct = parseOptions(question.options).filter((option) => option.correct);
  return correct.length > 0 ? correct.map((option) => option.text).join("; ") : null;
}

/**
 * Обратная сторона вопроса: эталон открытого либо правильный ответ + разбор
 * закрытого (spec 7.4/7.6). Общая для «Ключевых вопросов» и сессии тренажёра;
 * закрытые типы (в SRS попадают через quiz_fail/test_fail) показывают верные
 * варианты (single/multi/tf) или принятые ответы (short_text).
 */
export function QuestionAnswerBody({ question }: { question: Question }) {
  if (question.answerMd?.trim()) {
    return <LessonRenderer markdown={question.answerMd} />;
  }
  const answerText = correctAnswerText(question);
  return (
    <div className="flex flex-col gap-2">
      {answerText && (
        <p>
          <span className="text-text-2">Правильный ответ: </span>
          {answerText}
        </p>
      )}
      {question.explanationMd?.trim() ? (
        <LessonRenderer markdown={question.explanationMd} />
      ) : (
        !answerText && <p className="text-text-2">Разбор появится позже.</p>
      )}
    </div>
  );
}
