import { describe, expect, it } from "vitest";
import { markRecommendedPath, sortByRecommendedPath } from "@/lib/services/course-order";

// Recommended course path (changelog 13.6): welcome first → track order → own
// order; badges only, no gating.

function course(id: string, slug: string, order: number) {
  return { id, slug, order };
}

describe("sortByRecommendedPath", () => {
  it("puts the welcome course first even when the track order omits it", () => {
    const courses = [course("c1", "nlp", 1), course("c2", "welcome", 9), course("c3", "ds", 2)];
    const sorted = sortByRecommendedPath(courses, ["c3", "c1"]);
    expect(sorted.map((c) => c.slug)).toEqual(["welcome", "ds", "nlp"]);
  });

  it("puts welcome first with no track at all (order alone would not)", () => {
    const courses = [course("c1", "nlp", 1), course("c2", "welcome", 5)];
    expect(sortByRecommendedPath(courses, []).map((c) => c.slug)).toEqual(["welcome", "nlp"]);
  });

  it("follows the track order, then falls back to own order for the rest", () => {
    const courses = [
      course("a", "aa", 3),
      course("b", "bb", 1),
      course("c", "cc", 2),
      course("d", "dd", 0),
    ];
    // Track ranks c then a; bb/dd are off-track → by their own order (dd=0, bb=1).
    expect(sortByRecommendedPath(courses, ["c", "a"]).map((c) => c.id)).toEqual([
      "c",
      "a",
      "d",
      "b",
    ]);
  });

  it("does not mutate the input array", () => {
    const courses = [course("c1", "nlp", 1), course("c2", "welcome", 9)];
    sortByRecommendedPath(courses, []);
    expect(courses.map((c) => c.slug)).toEqual(["nlp", "welcome"]);
  });
});

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
