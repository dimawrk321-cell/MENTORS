import { describe, it, expect, beforeEach } from "vitest";
import type { GuideSection } from "@prisma/client";
import { testDb, resetDb } from "./helpers/db";
import {
  searchGuidesByContent,
  listSimilarGuides,
  hasVisibleGuides,
} from "@/lib/services/guides";

// D6 (spec 13.1): guide content FTS, «Похожие гайды», and the nav-visibility check.

const ALL = { resume: true, legend: true };
let seq = 0;
async function makeGuide(section: GuideSection, title: string, content: string) {
  seq += 1;
  return testDb.guide.create({
    data: { slug: `g${seq}`, section, title, order: seq, contentMd: content, status: "published" },
  });
}

describe("smart guides (spec 13.1/D6)", () => {
  beforeEach(async () => {
    await resetDb();
    seq = 0;
  });

  it("searchGuidesByContent matches BODY text (not just the title)", async () => {
    await makeGuide("stages", "Как пройти скрининг", "Готовься к вопросам про метрики и валидацию.");
    const hits = await searchGuidesByContent(testDb, "валидация", ALL);
    expect(hits.length).toBe(1);
    expect(hits[0]!.title).toBe("Как пройти скрининг");
    // A cleaned, highlighted snippet is returned.
    expect(hits[0]!.snippet).toContain("<mark>");
  });

  it("searchGuidesByContent respects the resume/legend section gates", async () => {
    await makeGuide("resume", "Резюме гайд", "структура резюме и метрики проектов");
    const gated = await searchGuidesByContent(testDb, "метрики", { resume: false, legend: true });
    expect(gated.length).toBe(0);
    const open = await searchGuidesByContent(testDb, "метрики", ALL);
    expect(open.length).toBe(1);
  });

  it("listSimilarGuides returns others in the same section, excluding self", async () => {
    const a = await makeGuide("stages", "A", "x");
    await makeGuide("stages", "B", "y");
    await makeGuide("job_search", "C", "z"); // different section
    const similar = await listSimilarGuides(testDb, { section: "stages", excludeId: a.id });
    expect(similar.map((g) => g.title)).toEqual(["B"]);
  });

  it("hasVisibleGuides reflects reachable content", async () => {
    expect(await hasVisibleGuides(testDb, ALL)).toBe(false);
    await makeGuide("stages", "Гайд", "текст");
    expect(await hasVisibleGuides(testDb, ALL)).toBe(true);
  });

  it("hasVisibleGuides ignores gated sections the student can't see", async () => {
    await makeGuide("resume", "Только резюме", "текст");
    expect(await hasVisibleGuides(testDb, { resume: false, legend: false })).toBe(false);
    expect(await hasVisibleGuides(testDb, { resume: true, legend: false })).toBe(true);
  });
});
