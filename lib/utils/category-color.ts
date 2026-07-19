import type * as React from "react";

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

/**
 * Theme-aware TEXT colour for a category label (spec 5.1 pair + 12.2 a11y).
 * On dark it is the pure colour (reads on its own 12% tint); on light it is
 * darkened 45% toward black via --cat-ink/--cat-ink-amt, because the pure colour
 * on its tint over white fails the 4.5 floor (2.3–2.9). Pair with a
 * `color-mix(... 12%, transparent)` background of the same colour.
 */
export function categoryTextColor(colorIndex: number): string {
  return `color-mix(in srgb, var(--cat-ink) var(--cat-ink-amt), ${categoryColorVar(colorIndex)})`;
}

/** Convenience: the full themed label style (12% tint background + safe text). */
export function categoryLabelStyle(colorIndex: number): React.CSSProperties {
  return {
    color: categoryTextColor(colorIndex),
    background: `color-mix(in srgb, ${categoryColorVar(colorIndex)} 12%, transparent)`,
  };
}
