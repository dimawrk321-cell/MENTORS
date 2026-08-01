import { describe, expect, it } from "vitest";
import { markRecommendedPath } from "@/lib/services/course-order";

// Course path badges (changelog 13.6). Ordering itself moved to the hard chain
// (block 2v2), and completion is now supplied by the caller from the chain's own
// rule — what is left here is only the «Начни отсюда» marking.

describe("markRecommendedPath", () => {
  it("marks the first incomplete course as next", () => {
    const marked = markRecommendedPath([
      { isCompleted: true },
      { isCompleted: false },
      { isCompleted: false },
    ]);
    expect(marked.map((c) => c.isNext)).toEqual([false, true, false]);
  });

  it("marks exactly one next course", () => {
    const marked = markRecommendedPath([{ isCompleted: false }, { isCompleted: false }]);
    expect(marked.filter((c) => c.isNext)).toHaveLength(1);
  });

  it("leaves no next course when everything is finished", () => {
    const marked = markRecommendedPath([{ isCompleted: true }, { isCompleted: true }]);
    expect(marked.some((c) => c.isNext)).toBe(false);
  });

  it("passes the caller's completion through untouched", () => {
    // The regression this guards: the function used to recompute completion from
    // lesson counts and disagree with the chain on a course ending in a test.
    const marked = markRecommendedPath([
      { isCompleted: false, lessonsTotal: 3, lessonsCompleted: 3 },
    ]);
    expect(marked[0]!.isCompleted).toBe(false);
    expect(marked[0]!.isNext).toBe(true);
  });
});
