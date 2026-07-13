import { describe, it, expect } from "vitest";
import {
  CATEGORY_PALETTE_SIZE,
  categoryColorIndex,
  categoryColorVar,
} from "@/lib/utils/category-color";

// Spec 5.1: category color_index beyond the 8-colour palette must wrap by
// modulo so imported non-seed categories (index 8, 9, …) still get a valid
// --cat-N and their chips don't break.

describe("categoryColorIndex — wrap into the 8-colour palette", () => {
  it("passes 0..7 through unchanged", () => {
    for (let i = 0; i < CATEGORY_PALETTE_SIZE; i += 1) {
      expect(categoryColorIndex(i)).toBe(i);
    }
  });

  it("wraps indices beyond the palette (imported Скрининг=8, Top Grading=9)", () => {
    expect(categoryColorIndex(8)).toBe(0);
    expect(categoryColorIndex(9)).toBe(1);
    expect(categoryColorIndex(15)).toBe(7);
    expect(categoryColorIndex(16)).toBe(0);
  });

  it("is defensive against negatives and non-integers", () => {
    expect(categoryColorIndex(-1)).toBe(7);
    expect(categoryColorIndex(-8)).toBe(0);
    expect(categoryColorIndex(8.9)).toBe(0);
  });

  it("categoryColorVar never emits an out-of-range --cat-N", () => {
    expect(categoryColorVar(8)).toBe("var(--cat-0)");
    expect(categoryColorVar(9)).toBe("var(--cat-1)");
    expect(categoryColorVar(3)).toBe("var(--cat-3)");
  });
});
