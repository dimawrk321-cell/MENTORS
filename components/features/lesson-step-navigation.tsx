"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { completeLessonStepAction } from "@/lib/actions/content";
import { cn } from "@/lib/utils/cn";
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";

export function LessonStepProgress({
  lessonId,
  steps,
  activeStepId,
}: {
  lessonId: string;
  steps: Array<{ id: string; title: string; completed: boolean }>;
  activeStepId: string;
}) {
  return (
    <nav aria-label="Шаги урока" className="border-border bg-surface-1 mb-6 rounded-xl border p-3">
      <p className="text-text-3 mb-2 text-xs font-medium tracking-wide uppercase">Шаги урока</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {steps.map((step, index) => (
          <Link
            key={step.id}
            href={`/lessons/${lessonId}?step=${step.id}`}
            aria-current={step.id === activeStepId ? "step" : undefined}
            className={cn(
              "border-border text-text-2 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              step.id === activeStepId && "border-accent bg-accent/10 text-text-1",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-xs",
                step.completed ? "bg-success/15 text-success" : "bg-surface-2",
              )}
            >
              {step.completed ? <Check size={12} /> : index + 1}
            </span>
            {step.title}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function CompleteLessonStepButton({
  lessonId,
  stepId,
  nextStepId,
  completed,
}: {
  lessonId: string;
  stepId: string;
  nextStepId: string | null;
  completed: boolean;
}) {
  const router = useRouter();
  const viewOnly = useViewOnly();
  const [done, setDone] = useState(completed);
  const [pending, startTransition] = useTransition();

  if (done && nextStepId) {
    return (
      <Button size="lg" asChild>
        {" "}
        <Link href={`/lessons/${lessonId}?step=${nextStepId}`}>
          Следующий шаг <ChevronRight size={16} />
        </Link>{" "}
      </Button>
    );
  }
  if (done) {
    return (
      <Button variant="secondary" size="lg" disabled>
        <Check size={16} className="text-success" /> Урок завершён
      </Button>
    );
  }
  if (viewOnly) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="lg" disabled title={VIEW_ONLY_TITLE}>
          Завершить шаг
        </Button>
        <ViewOnlyNote>Режим просмотра: прогресс ученика не меняется.</ViewOnlyNote>
      </div>
    );
  }
  return (
    <Button
      size="lg"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await completeLessonStepAction({ lessonId, stepId });
          if (!result?.ok) {
            if (result) toast({ title: result.error.message, variant: "danger" });
            return;
          }
          setDone(true);
          router.refresh();
        })
      }
    >
      Завершить шаг
    </Button>
  );
}
