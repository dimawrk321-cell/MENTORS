"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { haptic } from "@/lib/utils/haptic";

// Кольцо дневной цели (spec 5.3/7.7): SVG-кольцо с градиентной заливкой. Ритуал
// закрытия — glow ≤500мс + вибрация (spec 5.4), один раз в день (localStorage по
// дате в TZ). prefers-reduced-motion отключает анимацию (глобально в globals.css)
// и вибрацию (внутри haptic). Градиент кольца — одно из трёх разрешённых мест (5.1).

interface GoalRingProps {
  /** XP за сегодня. */
  value: number;
  /** Дневная цель (daily_goal_xp). */
  goal: number;
  /** Сегодняшняя дата (TZ) — ключ разового ритуала за день. */
  dayKey: string;
  size?: number;
}

export function GoalRing({ value, goal, dayKey, size = 76 }: GoalRingProps) {
  const progress = goal > 0 ? Math.min(value / goal, 1) : 0;
  const closed = progress >= 1;
  const [glow, setGlow] = useState(false);

  useEffect(() => {
    if (!closed) return;
    const key = `mentors:goalRing:${dayKey}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // приватный режим / недоступный storage — ритуал просто не запомнится
    }
    setGlow(true);
    haptic();
    const timer = setTimeout(() => setGlow(false), 500);
    return () => clearTimeout(timer);
  }, [closed, dayKey]);

  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * progress;
  const center = size / 2;

  return (
    <div
      className={cn("relative shrink-0", glow && "goal-ring-glow")}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Дневная цель: ${value} из ${goal} XP`}
      >
        <defs>
          <linearGradient id="goalRingGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5e6ad2" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="var(--border)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="url(#goalRingGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
          className="ease-app transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-semibold">{Math.round(progress * 100)}%</span>
        <span className="text-text-3 text-[11px]">цель</span>
      </div>
    </div>
  );
}
