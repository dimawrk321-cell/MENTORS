import { describe, expect, it } from "vitest";
import { markRecommendedPath } from "@/lib/services/course-order";

// Course path badges (changelog 13.6). Ordering itself moved to the hard chain
// (block 2v2) — what is left here is the «Начни отсюда» / «пройден» marking.

describe("markRecommendedPath", () => {
  it("marks the first incomplete course as next and completed ones as completed", () => {
    const marked = markRecommendedPath([
      { lessonsTotal: 4, lessonsCompleted: 4 },
      { lessonsTotal: 5, lessonsCompleted: 2 },
      { lessonsTotal: 3, lessonsCompleted: 0 },
    ]);
    expect(marked.map((c) => [c.isCompleted, c.isNext])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
  });

  it("marks exactly one next course", () => {
    const marked = markRecommendedPath([
      { lessonsTotal: 2, lessonsCompleted: 0 },
      { lessonsTotal: 2, lessonsCompleted: 0 },
    ]);
    expect(marked.filter((c) => c.isNext)).toHaveLength(1);
  });

  it("treats an empty course as not completed (nothing to tick yet)", () => {
    const marked = markRecommendedPath([{ lessonsTotal: 0, lessonsCompleted: 0 }]);
    expect(marked[0]!.isCompleted).toBe(false);
    // …and it is still a valid «next» target, so the student is sent somewhere.
    expect(marked[0]!.isNext).toBe(true);
  });

  it("leaves no next course when everything is finished", () => {
    const marked = markRecommendedPath([
      { lessonsTotal: 1, lessonsCompleted: 1 },
      { lessonsTotal: 2, lessonsCompleted: 2 },
    ]);
    expect(marked.some((c) => c.isNext)).toBe(false);
    expect(marked.every((c) => c.isCompleted)).toBe(true);
  });

  it("counts over-completion (extra optional lessons) as complete", () => {
    const marked = markRecommendedPath([{ lessonsTotal: 3, lessonsCompleted: 5 }]);
    expect(marked[0]!.isCompleted).toBe(true);
  });
});
