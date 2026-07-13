// Spec 5.1: 8 muted category colour pairs, exposed as CSS vars --cat-0..--cat-7
// and assigned to categories by color_index. The Notion importer can create
// more than 8 root categories (8 seed + «Скрининг», «Top Grading»), so a
// color_index may exceed 7 — and `var(--cat-8)` is undefined, which collapses
// the chip's colour. All chip colours go through this wrap so an out-of-range
// index cycles back into the palette instead of breaking.

export const CATEGORY_PALETTE_SIZE = 8;

/** Wraps any integer color_index into the 0..7 palette range (spec 5.1). */
export function categoryColorIndex(colorIndex: number): number {
  const n = Math.trunc(colorIndex) % CATEGORY_PALETTE_SIZE;
  return (n + CATEGORY_PALETTE_SIZE) % CATEGORY_PALETTE_SIZE;
}

/** CSS `var(--cat-N)` for a (possibly out-of-range) color_index. */
export function categoryColorVar(colorIndex: number): string {
  return `var(--cat-${categoryColorIndex(colorIndex)})`;
}
