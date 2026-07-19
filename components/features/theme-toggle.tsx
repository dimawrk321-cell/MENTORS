"use client";

import { useEffect, useState, useTransition } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { updateThemeAction } from "@/lib/actions/profile";

// Quick theme toggle (spec 12.1/B1): a header icon (desktop) and an «Ещё» menu row
// (mobile) that cycle система → тёмная → светлая. The profile setting (users.theme)
// stays the source of truth — every switch writes it via updateThemeAction. The DOM
// + localStorage change apply instantly (mirroring the anti-FOUC script in
// app/layout.tsx); the DB write is best-effort (ignored on failure, e.g. while
// impersonating — the local change still gives the viewer their preferred theme).

type ThemeChoice = "system" | "dark" | "light";

const CHOICES: ThemeChoice[] = ["system", "dark", "light"];
const LABEL: Record<ThemeChoice, string> = {
  system: "Системная",
  dark: "Тёмная",
  light: "Светлая",
};
const ICON: Record<ThemeChoice, LucideIcon> = { system: Monitor, dark: Moon, light: Sun };
const THEME_EVENT = "mentors:themechange";

function resolve(choice: ThemeChoice): "dark" | "light" {
  if (choice === "dark" || choice === "light") return choice;
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(choice: ThemeChoice) {
  try {
    localStorage.setItem("theme", choice);
    document.documentElement.dataset.theme = resolve(choice);
    window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }));
  } catch {
    // localStorage may be unavailable (private mode) — theme just won't persist.
  }
}

function useThemeToggle(initial: ThemeChoice) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  const [, start] = useTransition();

  // Reconcile to what the anti-FOUC script actually applied (localStorage), and
  // keep multiple toggles (header + «Ещё») in sync within the page.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "system" || stored === "dark" || stored === "light") setChoice(stored);
    } catch {
      // ignore
    }
    const onChange = (e: Event) => setChoice((e as CustomEvent<ThemeChoice>).detail);
    window.addEventListener(THEME_EVENT, onChange);
    return () => window.removeEventListener(THEME_EVENT, onChange);
  }, []);

  const cycle = () => {
    const next = CHOICES[(CHOICES.indexOf(choice) + 1) % CHOICES.length]!;
    setChoice(next);
    apply(next);
    start(async () => {
      await updateThemeAction({ theme: next });
    });
  };

  return { choice, cycle };
}

/** Header / sidebar icon button (desktop). */
export function ThemeToggleIcon({
  initialTheme,
  className,
}: {
  initialTheme: ThemeChoice;
  className?: string;
}) {
  const { choice, cycle } = useThemeToggle(initialTheme);
  const Icon = ICON[choice];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Тема: ${LABEL[choice]}. Переключить`}
      title={`Тема: ${LABEL[choice]}`}
      className={cn(
        "text-text-2 ease-app hover:text-text-1 flex size-11 items-center justify-center transition-colors duration-150 md:size-9",
        className,
      )}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/** Full-width row for the mobile «Ещё» sheet. */
export function ThemeToggleMenuItem({ initialTheme }: { initialTheme: ThemeChoice }) {
  const { choice, cycle } = useThemeToggle(initialTheme);
  const Icon = ICON[choice];
  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-control text-text-2 ease-app hover:bg-surface-1 hover:text-text-1 flex h-11 items-center gap-3 px-3 text-left text-[15px] transition-colors duration-150"
    >
      <Icon size={18} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className="flex-1">Тема</span>
      <span className="text-text-3 text-[13px]">{LABEL[choice]}</span>
    </button>
  );
}

/** Large tile for the mobile «Ещё» hub (spec 12.2/1.3): cycles theme in place. */
export function ThemeToggleTile({ initialTheme }: { initialTheme: ThemeChoice }) {
  const { choice, cycle } = useThemeToggle(initialTheme);
  const Icon = ICON[choice];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Тема: ${LABEL[choice]}. Переключить`}
      className="rounded-card border-border bg-surface-1 text-text-2 ease-app hover:border-border-strong hover:bg-surface-2 hover:text-text-1 flex min-h-[76px] flex-col justify-between gap-3 border p-3.5 text-left transition-colors duration-150"
    >
      <Icon size={22} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
      <span className="text-text-1 text-[14px] font-medium">
        Тема
        <span className="text-text-3 ml-1.5 font-normal">{LABEL[choice]}</span>
      </span>
    </button>
  );
}
