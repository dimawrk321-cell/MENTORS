import { describe, it, expect, beforeEach } from "vitest";
import type { ContentStatus } from "@prisma/client";
import { testDb, resetDb } from "./helpers/db";
import {
  bulkPublish,
  bulkSetDraft,
  listQuestionIdsForFilter,
} from "@/lib/services/questions";

// C1 (spec 13.1): bulk question operations — bulk «в черновик», the existing bulk
// publish (only valid targets, skip-count), and select-all-by-filter id listing.
// Each bulk op writes exactly one audit row with counts.

const ACTOR = "actor-1";
let categoryId = "";

async function seedActor() {
  await testDb.user.create({
    data: { email: "a@x.io", name: "A", role: "admin", avatarColor: 0, id: ACTOR },
  });
}

async function makeQuestion(status: ContentStatus, answer = "эталон") {
  const cat =
    categoryId ||
    (categoryId = (
      await testDb.questionCategory.create({
        data: { title: "Cat", slug: `cat-${Math.round(Math.random() * 1e6)}`, colorIndex: 0, order: 0 },
      })
    ).id);
  return testDb.question.create({
    data: { type: "open", categoryId: cat, textMd: "Вопрос?", answerMd: answer, status, difficulty: 1 },
  });
}

describe("bulk questions (spec 13.1/C1)", () => {
  beforeEach(async () => {
    await resetDb();
    categoryId = "";
    await seedActor();
  });

  it("bulkSetDraft unpublishes only published targets + one audit row with count", async () => {
    const p1 = await makeQuestion("published");
    const p2 = await makeQuestion("published");
    const d1 = await makeQuestion("draft");
    const res = await bulkSetDraft(testDb, {
      actorId: ACTOR,
      questionIds: [p1.id, p2.id, d1.id],
    });
    expect(res.updated).toBe(2); // only the two published flip
    expect((await testDb.question.findUnique({ where: { id: p1.id } }))!.status).toBe("draft");
    expect((await testDb.question.findUnique({ where: { id: d1.id } }))!.status).toBe("draft");
    const audits = await testDb.auditLog.findMany({ where: { action: "question.bulk_unpublished" } });
    expect(audits.length).toBe(1);
    expect((audits[0]!.after as { unpublished: number }).unpublished).toBe(2);
  });

  it("bulkPublish publishes valid drafts, skips invalid, one audit row", async () => {
    const good = await makeQuestion("draft", "есть ответ");
    const bad = await makeQuestion("draft", ""); // open question with no answer → invalid
    const res = await bulkPublish(testDb, {
      actorId: ACTOR,
      questionIds: [good.id, bad.id],
    });
    expect(res.published).toBe(1);
    expect(res.skipped).toBe(1);
    expect((await testDb.question.findUnique({ where: { id: good.id } }))!.status).toBe("published");
    expect((await testDb.question.findUnique({ where: { id: bad.id } }))!.status).toBe("draft");
    const audits = await testDb.auditLog.findMany({ where: { action: "question.bulk_published" } });
    expect(audits.length).toBe(1);
  });

  it("listQuestionIdsForFilter returns all matching ids (select-all-by-filter)", async () => {
    const p1 = await makeQuestion("published");
    const p2 = await makeQuestion("published");
    await makeQuestion("draft");
    const publishedIds = await listQuestionIdsForFilter(testDb, { status: "published" });
    expect(publishedIds.sort()).toEqual([p1.id, p2.id].sort());
    const allIds = await listQuestionIdsForFilter(testDb, {});
    expect(allIds.length).toBe(3);
  });
});
