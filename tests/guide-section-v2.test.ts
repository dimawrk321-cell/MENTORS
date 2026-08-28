import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_SECTION_COLOR, NEW_GUIDE_DAYS } from "@/lib/constants";
import { buildGuideSectionModel, type GuideSectionSource } from "@/lib/utils/guide-section";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function guide(id: string, overrides: Partial<GuideSectionSource> = {}): GuideSectionSource {
  return {
    id,
    slug: `guide-${id}`,
    title: `Глава ${id}`,
    contentMd: Array(180).fill("слово").join(" "),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("resume / legend landing model", () => {
  it("offers the first chapter when the section has no matching recent item", () => {
    const model = buildGuideSectionModel({
      guides: [guide("a"), guide("b", { contentMd: Array(181).fill("слово").join(" ") })],
      bookmarkedGuideIds: new Set(),
      recentGuideIds: ["another-section-guide"],
      now: NOW,
    });

    expect(model.focusKind).toBe("start");
    expect(model.focusIndex).toBe(0);
    expect(model.totalMinutes).toBe(3);
  });

  it("uses only the newest matching recent item without marking earlier chapters completed", () => {
    const model = buildGuideSectionModel({
      guides: [guide("a"), guide("b"), guide("c")],
      bookmarkedGuideIds: new Set(["b"]),
      recentGuideIds: ["outside", "c", "b"],
      now: NOW,
    });

    expect(model.focusKind).toBe("recent");
    expect(model.focusIndex).toBe(2);
    expect(model.chapters.map((chapter) => chapter.bookmarked)).toEqual([false, true, false]);
    expect(model.chapters[0]).not.toHaveProperty("completed");
  });

  it("applies the shared 14-day new threshold and stable section colours", () => {
    const inside = new Date(NOW.getTime() - (NEW_GUIDE_DAYS - 1) * 24 * 60 * 60 * 1000);
    const outside = new Date(NOW.getTime() - (NEW_GUIDE_DAYS + 1) * 24 * 60 * 60 * 1000);
    const model = buildGuideSectionModel({
      guides: [guide("new", { createdAt: inside }), guide("old", { createdAt: outside })],
      bookmarkedGuideIds: new Set(),
      recentGuideIds: [],
      now: NOW,
    });

    expect(model.chapters.map((chapter) => chapter.isNew)).toEqual([true, false]);
    expect(GUIDE_SECTION_COLOR.resume).toBe("var(--cat-0)");
    expect(GUIDE_SECTION_COLOR.legend).toBe("var(--cat-6)");
  });

  it("keeps both route-level access gates", () => {
    const root = resolve(__dirname, "..");
    const resumePage = readFileSync(resolve(root, "app/(student)/resume/page.tsx"), "utf8");
    const legendPage = readFileSync(resolve(root, "app/(student)/legend/page.tsx"), "utf8");

    expect(resumePage).toContain("if (!user.guidesResumeEnabled) notFound()");
    expect(legendPage).toContain("if (!user.guidesLegendEnabled) notFound()");
  });
});
