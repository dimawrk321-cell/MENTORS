import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { getRecentItems, touchRecentItem } from "@/lib/services/recent";
import { RECENT_KEEP } from "@/lib/constants";

// Stage 8 recency index (spec 7.11): upsert-on-open, recency order, visibility
// filtering, library gating, and pruning to the last RECENT_KEEP.

let userId = "";
let moduleId = "";

async function seed() {
  const user = await createTestUser({ email: "r@recent.test", role: "student" });
  userId = user.id;
  const course = await testDb.course.create({
    data: {
      slug: "c",
      title: "Курс",
      gating: "free",
      status: "published",
      modules: { create: [{ title: "M", order: 0, status: "published" }] },
    },
    include: { modules: true },
  });
  moduleId = course.modules[0]!.id;
}

let seq = 0;
async function makeLesson(title: string, status: "published" | "draft" = "published") {
  seq += 1;
  return testDb.lesson.create({
    data: { moduleId, slug: `l${seq}`, title, order: seq, status, contentMd: "x" },
  });
}
/** Distinct, increasing timestamps so recency order is deterministic. */
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));

describe("recent — touch & resolve (spec 7.11)", () => {
  beforeEach(async () => {
    await resetDb();
    seq = 0;
    await seed();
  });

  it("upserts (does not duplicate) and bumps recency on re-open", async () => {
    const l = await makeLesson("Урок");
    await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: l.id, now: at(1) });
    await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: l.id, now: at(2) });
    const rows = await testDb.recentItem.findMany({ where: { userId } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.openedAt.getTime()).toBe(at(2).getTime());
  });

  it("returns entries newest-first", async () => {
    const a = await makeLesson("A");
    const b = await makeLesson("B");
    await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: a.id, now: at(1) });
    await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: b.id, now: at(2) });
    const recent = await getRecentItems(testDb, { userId, libraryEnabled: true });
    expect(recent.map((r) => r.title)).toEqual(["B", "A"]);
    expect(recent[0]!.url).toBe(`/lessons/${b.id}`);
  });

  it("drops entities that became unpublished/deleted", async () => {
    const a = await makeLesson("Жив");
    const b = await makeLesson("Скрыт");
    await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: a.id, now: at(1) });
    await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: b.id, now: at(2) });
    await testDb.lesson.update({ where: { id: b.id }, data: { status: "draft" } });
    const recent = await getRecentItems(testDb, { userId, libraryEnabled: true });
    expect(recent.map((r) => r.title)).toEqual(["Жив"]);
  });

  it("hides recordings when library is disabled", async () => {
    const rec = await testDb.recording.create({
      data: {
        title: "Мок",
        stage: "theory",
        direction: "nlp",
        grade: "middle",
        outcome: "offer",
        companyType: "bigtech",
        durationMinutes: 60,
        url: "https://x",
        checklist: { faces: true, voice: true, names: true, consent: true },
        status: "published",
      },
    });
    await touchRecentItem(testDb, { userId, itemType: "recording", entityId: rec.id, now: at(1) });
    expect((await getRecentItems(testDb, { userId, libraryEnabled: true })).length).toBe(1);
    expect((await getRecentItems(testDb, { userId, libraryEnabled: false })).length).toBe(0);
  });

  it("shows at most 5 entries", async () => {
    for (let i = 0; i < 8; i += 1) {
      const l = await makeLesson(`L${i}`);
      await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: l.id, now: at(i) });
    }
    expect((await getRecentItems(testDb, { userId, libraryEnabled: true })).length).toBe(5);
  });

  it(`prunes to the last ${RECENT_KEEP} rows per user`, async () => {
    for (let i = 0; i < RECENT_KEEP + 5; i += 1) {
      const l = await makeLesson(`L${i}`);
      await touchRecentItem(testDb, { userId, itemType: "lesson", entityId: l.id, now: at(i) });
    }
    expect(await testDb.recentItem.count({ where: { userId } })).toBe(RECENT_KEEP);
  });
});
