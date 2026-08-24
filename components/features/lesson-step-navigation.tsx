"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { completeLessonStepAction } from "@/lib/actions/content";
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";

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
  const [optimisticallyCompletedStepId, setOptimisticallyCompletedStepId] = useState<string | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  // If the client component survives navigation, the optimistic state is tied
  // to its original step id and cannot leak into the next unfinished step.
  const done = completed || optimisticallyCompletedStepId === stepId;

  if (done && nextStepId) {
    return (
      <Button size="lg" asChild>
        <Link href={`/lessons/${lessonId}?step=${nextStepId}`}>
          Следующий шаг <ChevronRight size={16} />
        </Link>
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
          setOptimisticallyCompletedStepId(stepId);
          router.refresh();
        })
      }
    >
      Завершить шаг
    </Button>
  );
}
