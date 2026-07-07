import type { Question } from "@prisma/client";
import { ChevronDown, KeyRound } from "lucide-react";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { parseOptions } from "@/lib/utils/answers";

// Автоблок «Ключевые вопросы урока» (spec 7.3): is_key-вопросы, раскрывающиеся
// карточки вопрос → эталон. SRS-подключение — этап 4, подпись уже честная.

function AnswerBody({ question }: { question: Question }) {
  if (question.answerMd?.trim()) {
    return <LessonRenderer markdown={question.answerMd} />;
  }
  // DECISION: закрытый is_key-вопрос без answer_md показывает верные варианты
  // и разбор — эталона у него нет по модели данных.
  const correct = parseOptions(question.options).filter((option) => option.correct);
  return (
    <div className="flex flex-col gap-2">
      {correct.length > 0 && (
        <p>
          <span className="text-text-2">Правильный ответ: </span>
          {correct.map((option) => option.text).join("; ")}
        </p>
      )}
      {question.explanationMd?.trim() && <LessonRenderer markdown={question.explanationMd} />}
    </div>
  );
}

export function KeyQuestions({ questions }: { questions: Question[] }) {
  if (questions.length === 0) return null;

  return (
    <section className="border-border mt-10 border-t pt-6">
      <h2 className="flex items-center gap-2 text-[24px] font-semibold">
        <KeyRound size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Ключевые вопросы урока
      </h2>
      <p className="text-text-3 mt-1 mb-4 text-[13px]">Эти вопросы попадут в твои повторения.</p>
      <div className="flex flex-col gap-2">
        {questions.map((question) => (
          <details
            key={question.id}
            className="group rounded-card border-border bg-surface-1 open:border-border-strong border"
          >
            <summary className="flex cursor-pointer items-start gap-3 px-4 py-3.5 text-[15px] font-medium select-none [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1">
                <LessonRenderer markdown={question.textMd} />
              </span>
              <ChevronDown
                size={16}
                strokeWidth={1.75}
                className="text-text-3 ease-app mt-1 shrink-0 transition-transform duration-150 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="lesson-prose border-border border-t px-4 py-3.5 text-[15px]">
              <AnswerBody question={question} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
