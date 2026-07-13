// Question-category matching (spec 7.14 п.4/п.5). The 8 seed root categories
// (spec 7.4) are matched by NAME with case/ё normalization and fuzzy fallback,
// so the export's «АБ тесты и статистика» maps to seed «А/Б-тесты и статистика»
// and a lesson's «GIL» links to subcategory «GIL (глобальная блокировка…)».

/** The 8 seed root categories with their seeded slugs (prisma/seed.ts). */
export const SEED_ROOT_CATEGORIES: Array<{ title: string; slug: string }> = [
  { title: "Classic ML", slug: "classic-ml" },
  { title: "Python", slug: "python" },
  { title: "А/Б-тесты и статистика", slug: "ab-tests-statistics" },
  { title: "NLP", slug: "nlp" },
  { title: "Production", slug: "production" },
  { title: "RecSys", slug: "recsys" },
  { title: "SQL", slug: "sql" },
  { title: "ML System Design", slug: "ml-system-design" },
];

/**
 * Intermediate «stage» nodes under «Вопросы с собеседований» whose children are
 * the real root categories — made transparent so seed categories are matched a
 * level deeper than spec 7.14 п.5 assumed (real export nests them under
 * «Техническое собеседование»).
 */
export const TRANSPARENT_STAGE_TITLES = ["Техническое собеседование"];

/** Normalizes a name for comparison: lower, ё→е, drop everything non-alnum. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "");
}

/** Same, but with parenthetical qualifiers «(…)» stripped first. */
function normalizeNoParens(name: string): string {
  return normalizeName(name.replace(/\([^)]*\)/g, " "));
}

export interface NamedCategory {
  title: string;
}

/**
 * Best match of `target` among `candidates` by name (spec 7.14: fuzzy,
 * case/ё normalization). Strategies in order: exact-normalized, parens-stripped,
 * prefix (either direction, ≥3 chars). Returns the candidate or null.
 */
export function matchCategoryName<T extends NamedCategory>(
  target: string,
  candidates: T[],
): T | null {
  const t = normalizeName(target);
  if (!t) return null;

  const exact = candidates.find((c) => normalizeName(c.title) === t);
  if (exact) return exact;

  const tp = normalizeNoParens(target);
  const parens = candidates.find((c) => normalizeNoParens(c.title) === tp && tp.length > 0);
  if (parens) return parens;

  // Prefix either way — «GIL» ↔ «GIL (глобальная блокировка…)».
  const prefix = candidates
    .map((c) => ({ c, n: normalizeNoParens(c.title) }))
    .filter(({ n }) => n.length >= 3 && tp.length >= 3 && (n.startsWith(tp) || tp.startsWith(n)))
    // Prefer the closest length.
    .sort((a, b) => Math.abs(a.n.length - tp.length) - Math.abs(b.n.length - tp.length))[0];
  return prefix?.c ?? null;
}

/** Matches an export root-category node to a seed root category by name. */
export function matchSeedRoot(title: string) {
  return matchCategoryName(title, SEED_ROOT_CATEGORIES);
}
