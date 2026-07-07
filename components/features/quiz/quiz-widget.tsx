import type { Question } from "@prisma/client";
import { ListChecks } from "lucide-react";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { parseOptions } from "@/lib/utils/answers";
import { seededShuffle } from "@/lib/utils/shuffle";
import { QuizQuestion } from "./quiz-question";

// Квиз урока (spec 7.5): формативный, поштучные ответы, ничего не блокирует.
// Server component: вопросы и разборы рендерятся сервером и передаются в
// клиентские островки готовыми узлами (correct-флаги вариантов на клиент не
// уходят — проверка только на сервере).

export function QuizWidget({
  lessonId,
  userId,
  questions,
}: {
  lessonId: string;
  userId: string;
  questions: Question[];
}) {
  if (questions.length === 0) return null;

  return (
    <section className="border-border mt-10 border-t pt-6">
      <h2 className="flex items-center gap-2 text-[24px] font-semibold">
        <ListChecks size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Проверь себя
      </h2>
      <p className="text-text-3 mt-1 mb-4 text-[13px]">
        Ошибаться можно — квиз ничего не блокирует.
      </p>
      <div className="flex flex-col gap-3">
        {questions.map((question, index) => {
          // Стабильное перемешивание вариантов для пользователя (spec 7.5).
          const options = seededShuffle(
            parseOptions(question.options),
            `${userId}:${question.id}`,
          ).map((option) => ({ id: option.id, text: option.text }));

          return (
            <QuizQuestion
              key={question.id}
              lessonId={lessonId}
              questionId={question.id}
              index={index + 1}
              total={questions.length}
              type={question.type}
              options={options}
              questionNode={<LessonRenderer markdown={question.textMd} />}
              explanationNode={
                question.explanationMd?.trim() ? (
                  <LessonRenderer markdown={question.explanationMd} />
                ) : null
              }
            />
          );
        })}
      </div>
    </section>
  );
}
