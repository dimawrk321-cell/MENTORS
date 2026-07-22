import { describe, it, expect, beforeEach } from "vitest";
import type { ContentStatus } from "@prisma/client";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { bulkSetRecordingStatus } from "@/lib/services/library";

// C3 (spec 13.1): bulk publish only flips draft recordings that pass the 4/4
// checklist; the rest are skipped and counted. One audit row.

let seq = 0;
async function makeRecording(status: ContentStatus, complete: boolean) {
  seq += 1;
  return testDb.recording.create({
    data: {
      title: `R${seq}`,
      stage: "theory",
      direction: "nlp",
      grade: "middle",
      outcome: "offer",
      companyType: "bigtech",
      durationMinutes: 60,
      url: "https://disk.yandex/x",
      checklist: complete
        ? { faces: true, voice: true, names: true, consent: true }
        : { faces: true, voice: false, names: true, consent: true },
      status,
    },
  });
}

describe("bulk library (spec 13.1/C3)", () => {
  beforeEach(async () => {
    await resetDb();
    seq = 0;
  });

  it("publish flips only 4/4 drafts, skips the rest with a count", async () => {
    const owner = await createTestUser({ email: "o@x.io", role: "owner" });
    const good = await makeRecording("draft", true);
    const notReady = await makeRecording("draft", false); // 3/4 → skipped
    const already = await makeRecording("published", true); // not draft → skipped
    const res = await bulkSetRecordingStatus(testDb, {
      actorId: owner.id,
      recordingIds: [good.id, notReady.id, already.id],
      status: "published",
    });
    expect(res.updated).toBe(1);
    expect(res.skipped).toBe(2);
    expect((await testDb.recording.findUnique({ where: { id: good.id } }))!.status).toBe("published");
    expect((await testDb.recording.findUnique({ where: { id: notReady.id } }))!.status).toBe("draft");
    const audits = await testDb.auditLog.findMany({ where: { action: "recording.bulk_status" } });
    expect(audits).toHaveLength(1);
    expect((audits[0]!.after as { updated: number }).updated).toBe(1);
  });

  it("draft flips published → draft", async () => {
    const owner = await createTestUser({ email: "o2@x.io", role: "owner" });
    const p1 = await makeRecording("published", true);
    const p2 = await makeRecording("published", true);
    const res = await bulkSetRecordingStatus(testDb, {
      actorId: owner.id,
      recordingIds: [p1.id, p2.id],
      status: "draft",
    });
    expect(res.updated).toBe(2);
    expect(await testDb.recording.count({ where: { status: "draft" } })).toBe(2);
  });
});
