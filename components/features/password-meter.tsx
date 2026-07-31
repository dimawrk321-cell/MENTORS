"use client";

import { cn } from "@/lib/utils/cn";

// Strength meter for the invite/reset forms (spec 8.1). Heuristic, not a
// gate — the only hard rule is the 8-character minimum enforced server-side.

export function passwordScore(password: string): 0 | 1 | 2 | 3 {
  if (password.length < 8) return 0;
  const classes = [/[a-zа-яё]/i, /[A-ZА-ЯЁ]/, /\d/, /[^\w\sа-яё]/i].filter((re) =>
    re.test(password),
  ).length;
  if (password.length >= 12 && classes >= 3) return 3;
  if (password.length >= 10 && classes >= 2) return 2;
  return 1;
}

const meterStates: Record<0 | 1 | 2 | 3, { label: string; color: string; segments: number }> = {
  0: { label: "Минимум 8 символов", color: "text-text-3", segments: 0 },
  1: { label: "Слабый пароль", color: "text-danger", segments: 1 },
  2: { label: "Нормальный пароль", color: "text-warning", segments: 2 },
  3: { label: "Надёжный пароль", color: "text-success", segments: 3 },
};

const segmentColors = ["bg-danger", "bg-warning", "bg-success"] as const;

export function PasswordMeter({ password }: { password: string }) {
  const score = passwordScore(password);
  const state = meterStates[score];

  // Design handoff: four 3px tracks with the label inline on the right. The
  // score itself still tops out at 3 — the fourth track is the «headroom» the
  // prototype shows, so the scoring function is untouched.
  return (
    <div aria-live="polite" className="flex items-center gap-2">
      <div className="flex flex-1 gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "rounded-pill ease-app h-[3px] flex-1 transition-colors duration-150",
              i < state.segments
                ? (segmentColors[state.segments - 1] ?? "bg-surface-2")
                : "bg-surface-2",
            )}
          />
        ))}
      </div>
      <p className={cn("shrink-0 text-[11px]", state.color)}>{state.label}</p>
    </div>
  );
}
