"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { startTestAction } from "@/lib/actions/quiz-tests";
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";

/** Кнопка старта/пересдачи с кулдаун-таймером на самой кнопке (spec 7.5). */
export function StartTestButton({
  moduleId,
  kind,
  cooldownUntil,
  label,
}: {
  moduleId: string;
  kind: "module" | "testout";
  /** ISO-строка; до этого момента кнопка показывает обратный отсчёт. */
  cooldownUntil: string | null;
  label: string;
}) {
  const router = useRouter();
  const viewOnly = useViewOnly();
  const [pending, startTransition] = useTransition();
  // Pre-hydration the client cannot know the time without disagreeing with the
  // server's render — stay neutral until mounted (same shape as MockBookingCard).
  const [now, setNow] = useState<number | null>(null);

  const until = cooldownUntil ? new Date(cooldownUntil).getTime() : null;
  // `now === null` until mounted. A cooldown that the SERVER already knows about
  // still renders as a disabled button — just without a live countdown — so the
  // pre-hydration markup never claims the test is startable when it is not.
  const remainingMs = until !== null && now !== null ? until - now : 0;
  const onCooldown = remainingMs > 0;
  const cooldownPending = until !== null && now === null;

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!onCooldown) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [onCooldown]);

  if (cooldownPending) {
    return (
      <Button size="lg" disabled>
        Пересдача на кулдауне
      </Button>
    );
  }

  function start(): void {
    startTransition(async () => {
      const result = await startTestAction({ moduleId, kind });
      if (!result) return;
      if (result.ok) {
        router.refresh(); // страница перейдёт в режим прохождения
      } else {
        toast({ title: result.error.message, variant: "danger" });
        router.refresh();
      }
    });
  }

  if (onCooldown) {
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return (
      <Button size="lg" disabled>
        Пересдача через {minutes}:{String(seconds).padStart(2, "0")}
      </Button>
    );
  }

  // «Глазами ученика»: попытка теста — запись в чужой прогресс (spec 7.2).
  // Закрываем на входе: раньше кнопка запускалась и падала красным тостом.
  if (viewOnly) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button size="lg" disabled title={VIEW_ONLY_TITLE}>
          {label}
        </Button>
        <ViewOnlyNote>Режим просмотра: попытку теста завести нельзя.</ViewOnlyNote>
      </div>
    );
  }

  return (
    <Button size="lg" loading={pending} onClick={start}>
      {label}
    </Button>
  );
}
