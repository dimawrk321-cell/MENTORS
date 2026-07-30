"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { answerTestAction, finishTestAction } from "@/lib/actions/quiz-tests";
import { celebrateGamification } from "@/components/features/gamification-celebrate";

export interface RunnerQuestion {
  id: string;
  type: "single" | "multi" | "tf" | "short_text" | "open";
  questionNode: ReactNode;
  options: Array<{ id: string; text: string }>;
}

interface TestRunnerProps {
  attemptId: string;
  questions: RunnerQuestion[];
  /** Уже отвеченные (восстановление после перезагрузки — spec 8.3). */
  answeredIds: string[];
}

/**
 * TestRunner (spec 7.5/8.3): вопрос на экран, «Далее», прогресс без таймера;
 * попытка живёт в БД — обновление страницы продолжает с места остановки.
 * Верно/неверно не показывается до конца (это экзамен, не квиз).
 */
export function TestRunner({ attemptId, questions, answeredIds }: TestRunnerProps) {
  const router = useRouter();
  const answered = new Set(answeredIds);
  const firstUnanswered = questions.findIndex((question) => !answered.has(question.id));
  const [index, setIndex] = useState(
    firstUnanswered === -1 ? questions.length - 1 : firstUnanswered,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  const total = questions.length;
  const question = questions[index];
  if (!question) return null;

  const multi = question.type === "multi";
  const canSubmit = question.type === "short_text" ? text.trim().length > 0 : selected.length > 0;
  const isLast = index === total - 1;

  function toggleOption(id: string): void {
    if (multi) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelected([id]);
    }
  }

  function submit(): void {
    if (!question) return;
    const answer = question.type === "short_text" ? text : multi ? selected : selected[0];
    startTransition(async () => {
      const result = await answerTestAction({ attemptId, questionId: question.id, answer });
      if (!result) return;
      if (!result.ok && result.error.code !== "already_answered") {
        toast({ title: result.error.message, variant: "danger" });
        return;
      }
      if (isLast) {
        const finished = await finishTestAction(attemptId);
        if (finished && !finished.ok) {
          toast({ title: finished.error.message, variant: "danger" });
          return;
        }
        // XP (100/+50), достижения (perfect_test, five_first_try) и уровень — ритуалом.
        if (finished?.ok) celebrateGamification(finished.data.gamification);
        router.refresh(); // страница покажет результат
      } else {
        setIndex(index + 1);
        setSelected([]);
        setText("");
      }
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div>
        <div className="text-text-2 mb-2 flex items-baseline justify-between text-[13px]">
          <span>
            Вопрос {index + 1} из {total}
          </span>
        </div>
        <ProgressBar
          gradient
          value={((index + 1) / total) * 100}
          aria-label={`Вопрос ${index + 1} из ${total}`}
        />
      </div>

      <div className="border-border bg-surface-1 rounded-[20px] border p-6">
        <div className="lesson-prose mb-5 text-[16px] font-medium">{question.questionNode}</div>

        {question.type === "short_text" ? (
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Ответ"
            placeholder="Короткий ответ"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit && !pending) submit();
            }}
          />
        ) : (
          <div className="flex flex-col gap-2.5" role={multi ? "group" : "radiogroup"}>
            {question.options.map((option, optionIndex) => {
              const isSelected = selected.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  onClick={() => toggleOption(option.id)}
                  style={
                    isSelected
                      ? {
                          boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent)",
                        }
                      : undefined
                  }
                  className={cn(
                    "ease-app flex items-center gap-3.5 rounded-[12px] border px-4 py-3 text-left text-[15px] transition-[border-color,background-color,box-shadow] duration-150",
                    isSelected
                      ? "border-accent/70 bg-accent/10 text-text-1"
                      : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-[7px] text-[12px] font-semibold",
                      isSelected
                        ? "bg-accent text-white"
                        : "border-border-strong bg-surface-2 text-text-3 border",
                    )}
                    aria-hidden="true"
                  >
                    {String.fromCharCode(65 + optionIndex)}
                  </span>
                  <span className="flex-1">{option.text}</span>
                  {isSelected && (
                    <Check
                      size={16}
                      strokeWidth={2.25}
                      className="text-accent shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
        {multi && (
          <p className="text-text-3 mt-2 text-[12px]">Можно выбрать несколько вариантов.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-text-3 max-w-[40ch] text-[12px]">
          Верно или нет — узнаешь в конце: это экзамен, а не квиз.
        </span>
        <Button loading={pending} disabled={!canSubmit} onClick={submit}>
          {isLast ? "Завершить тест" : "Далее"}
        </Button>
      </div>
    </div>
  );
}
