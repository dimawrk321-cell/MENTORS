import { describe, it, expect, beforeEach } from "vitest";
import type { ContentStatus, GuideSection } from "@prisma/client";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import {
  isGuideBookmarked,
  listBookmarkedGuides,
  listPublishedGuides,
  searchGuidesByTitle,
  toggleBookmark,
} from "@/lib/services/guides";

// Stage 7 guides service (spec 7.10): published listing, title search, bookmarks
// (toggle + unique).

async function makeGuide(
  slug: string,
  title: string,
  section: GuideSection = "tools",
  status: ContentStatus = "published",
) {
  return testDb.guide.create({
    data: { slug, section, title, order: 0, contentMd: "текст", status },
  });
}

describe("guides — published listing & search (spec 7.10)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists only published guides", async () => {
    await makeGuide("docker", "Docker", "tools", "published");
    await makeGuide("draft-one", "Черновой гайд", "tools", "draft");
    const list = await listPublishedGuides(testDb);
    expect(list.length).toBe(1);
    expect(list[0]!.slug).toBe("docker");
  });

  it("searches published titles by substring, case-insensitive", async () => {
    await makeGuide("resume-head", "Шапка и контакты", "resume", "published");
    await makeGuide("legend-story", "Оформление легенды", "legend", "published");
    await makeGuide("draft-resume", "Резюме черновик", "resume", "draft");

    expect((await searchGuidesByTitle(testDb, "шапка")).length).toBe(1);
    expect((await searchGuidesByTitle(testDb, "легенд")).length).toBe(1);
    // Draft is excluded even on a match.
    expect((await searchGuidesByTitle(testDb, "черновик")).length).toBe(0);
    // Empty query returns nothing.
    expect((await searchGuidesByTitle(testDb, "   ")).length).toBe(0);
  });
});

describe("guides — bookmarks (spec 7.10)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("toggles a bookmark on and off, emitting bookmark.toggled each time", async () => {
    const student = await createTestUser({ email: "s@guides.test", role: "student" });
    const guide = await makeGuide("git", "Git", "tools", "published");

    const on = await toggleBookmark(testDb, { userId: student.id, guideId: guide.id });
    expect(on.ok && on.bookmarked).toBe(true);
    expect(await isGuideBookmarked(testDb, student.id, guide.id)).toBe(true);
    expect((await listBookmarkedGuides(testDb, student.id)).length).toBe(1);

    const off = await toggleBookmark(testDb, { userId: student.id, guideId: guide.id });
    expect(off.ok && off.bookmarked).toBe(false);
    expect(await isGuideBookmarked(testDb, student.id, guide.id)).toBe(false);
    expect((await listBookmarkedGuides(testDb, student.id)).length).toBe(0);

    expect(await testDb.analyticsEvent.count({ where: { type: "bookmark.toggled" } })).toBe(2);
  });

  it("enforces a unique (user, guide) bookmark", async () => {
    const student = await createTestUser({ email: "s2@guides.test", role: "student" });
    const guide = await makeGuide("kafka", "Kafka", "tools", "published");
    await testDb.bookmark.create({ data: { userId: student.id, guideId: guide.id } });
    await expect(
      testDb.bookmark.create({ data: { userId: student.id, guideId: guide.id } }),
    ).rejects.toThrow();
  });

  it("does not bookmark a draft (or missing) guide", async () => {
    const student = await createTestUser({ email: "s3@guides.test", role: "student" });
    const draft = await makeGuide("draft-guide", "Черновик", "tools", "draft");
    const res = await toggleBookmark(testDb, { userId: student.id, guideId: draft.id });
    expect(res.ok).toBe(false);
    expect(await testDb.bookmark.count()).toBe(0);
  });

  it("excludes bookmarks of unpublished guides from the list", async () => {
    const student = await createTestUser({ email: "s4@guides.test", role: "student" });
    const guide = await makeGuide("published-guide", "Опубликованный", "tools", "published");
    await testDb.bookmark.create({ data: { userId: student.id, guideId: guide.id } });
    // Guide later unpublished → the bookmark row survives but isn't listed.
    await testDb.guide.update({ where: { id: guide.id }, data: { status: "draft" } });
    expect((await listBookmarkedGuides(testDb, student.id)).length).toBe(0);
  });
});
