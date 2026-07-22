import { describe, it, expect, beforeEach } from "vitest";
import type { ContentStatus, GuideSection } from "@prisma/client";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { bulkSetGuideStatus } from "@/lib/services/guides";

// C2 (spec 13.1): bulk publish/draft for guides — only changed rows count, one audit.

let seq = 0;
async function makeGuide(section: GuideSection, status: ContentStatus) {
  seq += 1;
  return testDb.guide.create({
    data: { slug: `g${seq}`, section, title: `G${seq}`, order: seq, contentMd: "x", status },
  });
}

describe("bulk guides (spec 13.1/C2)", () => {
  beforeEach(async () => {
    await resetDb();
    seq = 0;
  });

  it("publishes selected drafts, counts only changed rows, one audit", async () => {
    const owner = await createTestUser({ email: "o@x.io", role: "owner" });
    const d1 = await makeGuide("stages", "draft");
    const d2 = await makeGuide("stages", "draft");
    const p1 = await makeGuide("stages", "published"); // already published → not counted
    const res = await bulkSetGuideStatus(testDb, {
      actorId: owner.id,
      guideIds: [d1.id, d2.id, p1.id],
      status: "published",
    });
    expect(res.updated).toBe(2);
    expect(await testDb.guide.count({ where: { status: "published" } })).toBe(3);
    const audits = await testDb.auditLog.findMany({ where: { action: "guide.bulk_status" } });
    expect(audits).toHaveLength(1);
    expect((audits[0]!.after as { updated: number }).updated).toBe(2);
  });

  it("drafts a whole section selection", async () => {
    const owner = await createTestUser({ email: "o2@x.io", role: "owner" });
    const p1 = await makeGuide("resume", "published");
    const p2 = await makeGuide("resume", "published");
    const res = await bulkSetGuideStatus(testDb, {
      actorId: owner.id,
      guideIds: [p1.id, p2.id],
      status: "draft",
    });
    expect(res.updated).toBe(2);
    expect(await testDb.guide.count({ where: { status: "draft" } })).toBe(2);
  });
});
