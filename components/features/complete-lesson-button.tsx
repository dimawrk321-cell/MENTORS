"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { completeLessonAction } from "@/lib/actions/content";

/**
 * «Завершить урок» (spec 7.3): quiet check, no ritual, auto-advance to the
 * next open lesson; the course page when everything is done.
 */
export function CompleteLessonButton({
  lessonId,
  completed,
}: {
  lessonId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function complete(): void {
    startTransition(async () => {
      const result = await completeLessonAction(lessonId);
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error.message, variant: "danger" });
        return;
      }
      if (result.data.nextLessonId && result.data.nextLessonId !== lessonId) {
        router.push(`/lessons/${result.data.nextLessonId}`);
      } else {
        toast({ title: "Все открытые уроки пройдены", variant: "success" });
        router.push(`/courses/${result.data.courseSlug}`);
      }
      router.refresh();
    });
  }

  if (completed) {
    return (
      <Button variant="secondary" size="lg" disabled>
        <Check size={16} strokeWidth={2} className="text-success" aria-hidden="true" />
        Урок завершён
      </Button>
    );
  }

  return (
    <Button size="lg" loading={pending} onClick={complete}>
      Завершить урок
    </Button>
  );
}
