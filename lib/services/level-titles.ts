// D7 (spec 13.1): level titles — a light, editable layer over the XP levels
// (7.7). Pure & client-safe (no server imports) so the dashboard/profile render
// it, the settings form edits it, and the event dispatcher reads it. The ladder
// is a code default that the owner overrides in /admin/settings (app_settings).

export interface LevelTitle {
  minLevel: number;
  title: string;
}

/**
 * Default ladder — платформенный тон с самоиронией индустрии (владелец
 * отредактирует в /admin/settings). Titles apply from `minLevel` upward until the
 * next entry; the last one covers «20+».
 */
export const DEFAULT_LEVEL_TITLES: LevelTitle[] = [
  { minLevel: 1, title: "Импортёр pandas" },
  { minLevel: 2, title: "Читатель Хабра" },
  { minLevel: 3, title: "Джун на испытательном" },
  { minLevel: 5, title: "Профессиональный оверфиттер" },
  { minLevel: 7, title: "Укротитель Jupyter" },
  { minLevel: 9, title: "Миддл с синдромом самозванца" },
  { minLevel: 11, title: "Гроккер трансформеров" },
  { minLevel: 13, title: "Приручитель GPU" },
  { minLevel: 15, title: "Сеньор-помидор" },
  { minLevel: 17, title: "Чемпион бенчмарков" },
  { minLevel: 19, title: "Профессор StackOverflow" },
  { minLevel: 20, title: "Тимлид, который всё ещё гуглит SQL JOIN" },
];

/** Levels that grant a milestone freeze bonus (spec 13.1/D7). */
export const LEVEL_MILESTONES = [5, 10, 15, 20] as const;

/** Freeze cap for a milestone bonus: 3 from level 10, else 2 (spec 13.1/D7). */
export function freezeCapForMilestone(milestone: number): number {
  return milestone >= 10 ? 3 : 2;
}

/** Title for a level = the highest ladder entry with minLevel ≤ level ("" if none). */
export function titleForLevel(level: number, ladder: LevelTitle[] = DEFAULT_LEVEL_TITLES): string {
  let title = "";
  for (const entry of [...ladder].sort((a, b) => a.minLevel - b.minLevel)) {
    if (entry.minLevel <= level) title = entry.title;
    else break;
  }
  return title;
}

/** Textarea editor format: one «<minLevel> <title>» per line. */
export function parseLevelTitles(text: string): LevelTitle[] {
  const out: LevelTitle[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const minLevel = Number(m[1]);
    const title = m[2]!.trim();
    if (minLevel >= 1 && title) out.push({ minLevel, title });
  }
  return dedupeByLevel(out);
}

export function serializeLevelTitles(ladder: LevelTitle[]): string {
  return [...ladder]
    .sort((a, b) => a.minLevel - b.minLevel)
    .map((e) => `${e.minLevel} ${e.title}`)
    .join("\n");
}

function dedupeByLevel(ladder: LevelTitle[]): LevelTitle[] {
  const byLevel = new Map<number, string>();
  for (const e of ladder) byLevel.set(e.minLevel, e.title); // last wins
  return [...byLevel.entries()]
    .map(([minLevel, title]) => ({ minLevel, title }))
    .sort((a, b) => a.minLevel - b.minLevel);
}

/** Validate a stored app_settings value into a ladder, or null if malformed. */
export function parseStoredLevelTitles(value: unknown): LevelTitle[] | null {
  if (!Array.isArray(value)) return null;
  const out: LevelTitle[] = [];
  for (const e of value) {
    if (
      e &&
      typeof e === "object" &&
      typeof (e as { minLevel?: unknown }).minLevel === "number" &&
      Number.isInteger((e as { minLevel: number }).minLevel) &&
      (e as { minLevel: number }).minLevel >= 1 &&
      typeof (e as { title?: unknown }).title === "string" &&
      ((e as { title: string }).title.trim().length > 0)
    ) {
      out.push({
        minLevel: (e as { minLevel: number }).minLevel,
        title: (e as { title: string }).title.trim(),
      });
    }
  }
  return out.length > 0 ? dedupeByLevel(out) : null;
}
