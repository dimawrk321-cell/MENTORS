"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/toast";
import { updateReadingFontSizeAction } from "@/lib/actions/profile";

// Reading font-size S/M/L (spec 12.1/C9). The size is server-rendered onto
// `.lesson-prose[data-reading-size]` (no FOUC — the pref comes from the DB), so this
// control just flips that attribute for an instant live change and persists to the
// profile. Rollback + toast on failure (impersonation / expired access).

type Size = "s" | "m" | "l";

const SIZES: { key: Size; label: string }[] = [
  { key: "s", label: "S" },
  { key: "m", label: "M" },
  { key: "l", label: "L" },
];

function applyToProse(size: Size) {
  document.querySelector<HTMLElement>(".lesson-prose")?.setAttribute("data-reading-size", size);
}

export function ReadingSizeControl({ initial }: { initial: Size }) {
  const [size, setSize] = useState<Size>(initial);
  const [, start] = useTransition();

  const change = (next: Size) => {
    if (next === size) return;
    const prev = size;
    setSize(next);
    applyToProse(next);
    start(async () => {
      const res = await updateReadingFontSizeAction({ size: next });
      if (res && !res.ok) {
        setSize(prev);
        applyToProse(prev);
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

  return (
    <div
      role="group"
      aria-label="Размер шрифта чтения"
      className="rounded-control border-border inline-flex h-8 items-center border p-0.5"
    >
      {SIZES.map((s) => (
        <button
          key={s.key}
          type="button"
          onClick={() => change(s.key)}
          aria-pressed={size === s.key}
          className={cn(
            "ease-app flex h-full items-center rounded-[7px] px-2 text-[13px] transition-colors duration-150",
            size === s.key ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
