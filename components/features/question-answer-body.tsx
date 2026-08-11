import type { Question } from "@prisma/client";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { correctAnswerText } from "@/lib/utils/answers";

// Only the answer-shaping fields are read, so the prop is a structural subset of
// Question — a `select`ed catalog row (walk 13.5 block 1) satisfies it too.
type AnswerQuestion = Pick<
  Question,
  "type" | "answerMd" | "options" | "acceptedAnswers" | "explanationMd"
>;

/**
 * Обратная сторона вопроса: эталон открытого либо правильный ответ + разбор
 * закрытого (spec 7.4/7.6). Общая для «Ключевых вопросов» и сессии тренажёра;
 * закрытые типы (в SRS попадают через quiz_fail/test_fail) показывают верные
 * варианты (single/multi/tf) или принятые ответы (short_text).
 */
export function QuestionAnswerBody({ question }: { question: AnswerQuestion }) {
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
        // Второй рубеж (заход «Доступ к вопросам», 1.2): выборки такой вопрос
        // ученику уже не отдают, но если карточка всё же доехала — честный
        // текст и кнопки оценки рядом, а не тупик с пустым телом.
        !answerText && <p className="text-text-2">Ответ не заполнен.</p>
      )}
    </div>
  );
}
