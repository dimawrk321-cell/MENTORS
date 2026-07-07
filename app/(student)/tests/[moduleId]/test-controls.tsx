"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { startTestAction } from "@/lib/actions/quiz-tests";

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
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  const until = cooldownUntil ? new Date(cooldownUntil).getTime() : null;
  const remainingMs = until !== null ? until - now : 0;
  const onCooldown = remainingMs > 0;

  useEffect(() => {
    if (!onCooldown) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [onCooldown]);

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

  return (
    <Button size="lg" loading={pending} onClick={start}>
      {label}
    </Button>
  );
}
