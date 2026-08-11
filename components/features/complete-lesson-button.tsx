"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { completeLessonAction } from "@/lib/actions/content";
import { celebrateGamification } from "@/components/features/gamification-celebrate";
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";

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
  const viewOnly = useViewOnly();
  const [pending, startTransition] = useTransition();

  function complete(): void {
    startTransition(async () => {
      const result = await completeLessonAction(lessonId);
      if (!result) return;
      if (!result.ok) {
        toast({ title: result.error.message, variant: "danger" });
        return;
      }
      // Тихий чек урока (spec 7.3), но XP/достижения/уровень — ритуалом (spec 5.4).
      celebrateGamification(result.data.gamification);
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

  // «Глазами ученика»: прогресс ученика чужой и не пишется (spec 7.2) — кнопка
  // закрыта на входе, а не отбивается тостом после клика.
  if (viewOnly) {
    return (
      <div className="flex flex-col gap-2">
        <Button size="lg" disabled title={VIEW_ONLY_TITLE}>
          Завершить урок
        </Button>
        <ViewOnlyNote>Режим просмотра: прогресс ученика не меняется.</ViewOnlyNote>
      </div>
    );
  }

  return (
    <Button size="lg" loading={pending} onClick={complete}>
      Завершить урок
    </Button>
  );
}
