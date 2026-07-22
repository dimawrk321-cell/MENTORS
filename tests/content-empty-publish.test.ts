import { describe, it, expect } from "vitest";
import {
  courseHasPublishedLesson,
  moduleHasPublishedLesson,
  isEmptyPublishedCourse,
  isEmptyPublishedModule,
} from "@/lib/utils/content-status";

// A3 (spec 13.1): the empty-shell publish guard predicates that drive the studio
// warning badge and the pre-publish confirm.

describe("content publish guard — empty-shell predicates (spec 13.1/A3)", () => {
  it("moduleHasPublishedLesson: true only with a published lesson", () => {
    expect(moduleHasPublishedLesson({ status: "published", lessons: [] })).toBe(false);
    expect(moduleHasPublishedLesson({ status: "published", lessons: [{ status: "draft" }] })).toBe(
      false,
    );
    expect(
      moduleHasPublishedLesson({
        status: "published",
        lessons: [{ status: "draft" }, { status: "published" }],
      }),
    ).toBe(true);
  });

  it("courseHasPublishedLesson: scans all modules", () => {
    expect(
      courseHasPublishedLesson({
        status: "published",
        modules: [{ lessons: [{ status: "draft" }] }, { lessons: [] }],
      }),
    ).toBe(false);
    expect(
      courseHasPublishedLesson({
        status: "published",
        modules: [{ lessons: [{ status: "draft" }] }, { lessons: [{ status: "published" }] }],
      }),
    ).toBe(true);
  });

  it("isEmptyPublishedModule: only when PUBLISHED and no visible lessons", () => {
    // A draft module is never flagged (it isn't visible to students yet).
    expect(isEmptyPublishedModule({ status: "draft", lessons: [] })).toBe(false);
    expect(isEmptyPublishedModule({ status: "published", lessons: [] })).toBe(true);
    expect(
      isEmptyPublishedModule({ status: "published", lessons: [{ status: "published" }] }),
    ).toBe(false);
  });

  it("isEmptyPublishedCourse: only when PUBLISHED and no visible lessons", () => {
    expect(isEmptyPublishedCourse({ status: "draft", modules: [] })).toBe(false);
    expect(
      isEmptyPublishedCourse({
        status: "published",
        modules: [{ lessons: [{ status: "draft" }] }],
      }),
    ).toBe(true);
    expect(
      isEmptyPublishedCourse({
        status: "published",
        modules: [{ lessons: [{ status: "published" }] }],
      }),
    ).toBe(false);
  });
});
