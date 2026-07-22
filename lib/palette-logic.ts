import { SEARCH_GROUP_LABEL } from "@/lib/constants";

// Pure, framework-free logic for the CommandPalette (spec 5.3/7.11) — extracted
// so hotkey mapping and grouping/label logic are unit-testable without a browser.

export type PaletteGroupType = "lessons" | "questions" | "guides" | "recordings";

/**
 * Normalize a type to the plural PaletteGroupType used by GROUP_ICON.
 *
 * Search-result groups arrive plural ("lessons"), but «Недавнее» rows carry the
 * DB's singular RecentItemType ("lesson"/"guide"/…). The palette used the raw
 * value to index GROUP_ICON, so a recent row resolved to `undefined` and rendered
 * `<undefined/>` → React #130 (the crash of walk 13.1 / block 0.1). Returns null
 * for anything unrecognised so the caller can fall back to a safe default icon
 * rather than crash.
 */
const GROUP_TYPE_ALIASES: Record<string, PaletteGroupType> = {
  lesson: "lessons",
  lessons: "lessons",
  question: "questions",
  questions: "questions",
  guide: "guides",
  guides: "guides",
  recording: "recordings",
  recordings: "recordings",
  library: "recordings",
};

export function normalizeGroupType(type: string): PaletteGroupType | null {
  return GROUP_TYPE_ALIASES[type] ?? null;
}

/** Cmd+K (mac) / Ctrl+K (win/linux) toggles the palette (spec 7.11). */
export function isOpenPaletteHotkey(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  key: string;
}): boolean {
  return (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
}

/** Wrap-around list navigation for ArrowUp/ArrowDown (delta ±1). */
export function wrapIndex(current: number, len: number, delta: number): number {
  if (len <= 0) return 0;
  return (((current + delta) % len) + len) % len;
}

/** «Действия» filter: substring match on the label, case-insensitive (spec 7.11). */
export function filterActionsByQuery<T extends { title: string }>(
  actions: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return actions;
  return actions.filter((a) => a.title.toLowerCase().includes(q));
}

/**
 * Group heading (spec 7.11). The trgm fallback annotates every group with
 * «Возможно, вы искали»; otherwise it's the plain type label.
 */
export function groupLabel(type: PaletteGroupType, fuzzy: boolean): string {
  const base = SEARCH_GROUP_LABEL[type] ?? type;
  return fuzzy ? `${base} · Возможно, вы искали` : base;
}
