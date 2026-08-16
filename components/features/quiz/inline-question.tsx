import type { Question } from "@prisma/client";
import { HelpCircle } from "lucide-react";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { parseOptions } from "@/lib/utils/answers";
import { seededShuffle } from "@/lib/utils/shuffle";
import { QuizQuestion } from "./quiz-question";

// Вопрос из банка внутри текста урока (заход B.1, блок 2).
//
// Механизм ровно тот же, что у блока «Проверь себя» (spec 7.5): варианты
// перемешиваются на сервере, флаги правильности на клиент НЕ уходят, вердикт
// считает server action, ответ пишется в `quiz_answers`. Отличается только
// место на странице — поэтому переиспользуется тот же островок QuizQuestion, а
// не заводится вторая реализация квиза.

/**
 * Врезка-вопрос посреди прозы читается как остановка: шапка типа — как у
 * callout-карточки «Читалки v2», сама карточка вопроса остаётся той же, что в
 * блоке «Проверь себя» (второй рамки вокруг неё не рисуем).
 */
function InlineFrame({ children }: { children: React.ReactNode }) {
  return (
    <section className="my-5">
      <p className="accent-ink mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
        <HelpCircle size={14} strokeWidth={2} aria-hidden="true" />
        Вопрос
      </p>
      {children}
    </section>
  );
}

/** Интерактивный вопрос в тексте урока: тот же путь проверки, что у квиза. */
export function InlineQuestion({
  question,
  lessonId,
  userId,
  readOnly = false,
}: {
  question: Question;
  lessonId: string;
  /** null — предпросмотр студии: отвечать некому, порядок вариантов от урока. */
  userId: string | null;
  readOnly?: boolean;
}) {
  const options = seededShuffle(
    parseOptions(question.options),
    `${userId ?? lessonId}:${question.id}`,
  ).map((option) => ({ id: option.id, text: option.text }));

  return (
    <InlineFrame>
      <QuizQuestion
        lessonId={lessonId}
        questionId={question.id}
        type={question.type}
        options={options}
        readOnly={readOnly}
        readOnlyNote="Предпросмотр: ответить нельзя — вердикт считает сервер."
        questionNode={<LessonRenderer markdown={question.textMd} />}
        explanationNode={
          question.explanationMd?.trim() ? (
            <LessonRenderer markdown={question.explanationMd} />
          ) : null
        }
      />
    </InlineFrame>
  );
}
