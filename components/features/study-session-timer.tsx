"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { formatStudyTimer, studySessionTimer } from "@/lib/utils/study-session-summary";

export function StudySessionTimer({
  startedAt,
  plannedBlocks,
  blockMinutes,
}: {
  startedAt: string;
  plannedBlocks: number;
  blockMinutes: number;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);
  const timer = studySessionTimer(
    startedAt,
    plannedBlocks,
    blockMinutes,
    nowMs ?? Date.parse(startedAt),
  );
  return (
    <div
      role="timer"
      aria-label={
        timer.overtime
          ? `Плановое время истекло ${formatStudyTimer(timer.overtimeSeconds)} назад`
          : `До конца планового времени ${formatStudyTimer(timer.remainingSeconds)}`
      }
      className={`rounded-control flex h-9 items-center gap-2 border px-3 text-[13px] tabular-nums ${
        timer.overtime
          ? "border-warning/35 bg-warning/8 text-warning"
          : "border-accent/30 bg-accent/10 text-accent"
      }`}
    >
      <Clock3 size={15} aria-hidden="true" />
      <span className="font-semibold">
        {timer.overtime
          ? `План +${formatStudyTimer(timer.overtimeSeconds)}`
          : `Осталось ${formatStudyTimer(timer.remainingSeconds)}`}
      </span>
      <span className="text-text-2 hidden font-normal sm:inline">
        из {plannedBlocks * blockMinutes} мин
      </span>
    </div>
  );
}
