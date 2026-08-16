"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { answerQuizAction } from "@/lib/actions/quiz-tests";
import { celebrateGamification } from "@/components/features/gamification-celebrate";
import { useViewOnly, ViewOnlyNote } from "@/components/features/view-only";

interface QuizQuestionProps {
  lessonId: string;
  questionId: string;
  /** Нумерация «Вопрос N из M» — только у блока «Проверь себя». */
  index?: number;
  total?: number;
  type: "single" | "multi" | "tf" | "short_text" | "open";
  options: Array<{ id: string; text: string }>;
  questionNode: ReactNode;
  /** Разбор — заранее отрендерен сервером, показывается после ответа. */
  explanationNode: ReactNode | null;
  /**
   * Заход B.1: предпросмотр студии рендерит тот же островок, но отвечать в нём
   * некому (нет ученика) — поведение то же, что у «Глазами ученика».
   */
  readOnly?: boolean;
  readOnlyNote?: string;
}

/** Один вопрос квиза: ответ → сразу верно/неверно + разбор (spec 7.5). */
export function QuizQuestion({
  lessonId,
  questionId,
  index,
  total,
  type,
  options,
  questionNode,
  explanationNode,
  readOnly = false,
  readOnlyNote,
}: QuizQuestionProps) {
  // «Глазами ученика»: проверить ответ нельзя — вердикт считает сервер, а он
  // мутацию отобьёт. Закрываемся на входе, чтобы ментор не выбирал вариант
  // впустую (spec 7.2).
  const viewOnly = useViewOnly() || readOnly;
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ correct: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const answered = result !== null;
  const multi = type === "multi";
  const canSubmit = type === "short_text" ? text.trim().length > 0 : selected.length > 0;

  function toggleOption(id: string): void {
    if (answered || viewOnly) return;
    if (multi) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelected([id]);
    }
  }

  function submit(): void {
    const answer = type === "short_text" ? text : multi ? selected : selected[0];
    startTransition(async () => {
      const res = await answerQuizAction({ lessonId, questionId, answer });
      if (!res) return;
      if (res.ok) {
        setResult({ correct: res.data.correct });
        // +5 XP за первый правильный, закрытие цели/достижения — ритуалом (spec 7.7).
        celebrateGamification(res.data.gamification);
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  }

  return (
    <div
      className={cn(
        "rounded-card bg-surface-1 ease-app border p-4 transition-colors duration-150",
        result === null && "border-border",
        result?.correct === true && "border-success/50",
        result?.correct === false && "border-danger/50",
      )}
    >
      {index !== undefined && total !== undefined && (
        <p className="text-text-3 mb-2 text-[12px]">
          Вопрос {index} из {total}
        </p>
      )}
      <div className="lesson-prose mb-3 font-medium">{questionNode}</div>

      {type === "short_text" ? (
        <div className="flex max-w-md gap-2">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={answered || viewOnly}
            aria-label="Ответ"
            placeholder="Короткий ответ"
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit && !answered) submit();
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5" role={multi ? "group" : "radiogroup"}>
          {options.map((option) => {
            const isSelected = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={isSelected}
                disabled={answered || viewOnly}
                onClick={() => toggleOption(option.id)}
                className={cn(
                  "rounded-control ease-app border px-3.5 py-2.5 text-left text-[14px] transition-colors duration-150",
                  isSelected
                    ? "border-accent bg-accent/8 text-text-1"
                    : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
                  answered && "pointer-events-none opacity-80",
                )}
              >
                {option.text}
              </button>
            );
          })}
        </div>
      )}

      {!answered &&
        (viewOnly ? (
          <ViewOnlyNote className="mt-3">
            {readOnlyNote ?? "Режим просмотра: ответить нельзя — вердикт и разбор считает сервер."}
          </ViewOnlyNote>
        ) : (
          <div className="mt-3">
            <Button size="sm" loading={pending} disabled={!canSubmit} onClick={submit}>
              Ответить
            </Button>
          </div>
        ))}

      {result && (
        <div className="border-border mt-3 border-t pt-3" aria-live="polite">
          <p
            className={cn(
              "flex items-center gap-1.5 text-[14px] font-medium",
              result.correct ? "text-success" : "text-danger",
            )}
          >
            {result.correct ? (
              <>
                <Check size={15} strokeWidth={2.25} aria-hidden="true" /> Верно!
              </>
            ) : (
              <>
                <X size={15} strokeWidth={2.25} aria-hidden="true" /> Неверно
              </>
            )}
          </p>
          {explanationNode && (
            <div className="lesson-prose text-text-2 mt-2">{explanationNode}</div>
          )}
        </div>
      )}
    </div>
  );
}
