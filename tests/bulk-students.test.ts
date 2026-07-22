import { describe, it, expect, beforeEach } from "vitest";
import type { UserStatus } from "@prisma/client";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { bulkExtendAccess, grantFreeze, bulkGrantFreeze } from "@/lib/services/access";

// C5 (spec 13.1): bulk student ops — extend (+30/+90) and gift-freeze. Validity of
// targets (skip invited / non-students) and audit counters.

let seq = 0;
async function makeStudent(status: UserStatus, accessUntil: Date | null) {
  seq += 1;
  return testDb.user.create({
    data: {
      email: `s${seq}@x.io`,
      name: `S${seq}`,
      role: "student",
      status,
      accessUntil,
      avatarColor: 0,
    },
  });
}

const FUTURE = new Date("2027-01-01T00:00:00Z");

describe("bulk students (spec 13.1/C5)", () => {
  let actorId = "";
  beforeEach(async () => {
    await resetDb();
    seq = 0;
    actorId = (await createTestUser({ email: "owner@x.io", role: "owner" })).id;
  });

  it("bulkExtendAccess extends activated students, skips invited, counts both", async () => {
    const a1 = await makeStudent("active", FUTURE);
    const a2 = await makeStudent("expired", FUTURE);
    const invited = await makeStudent("invited", null);
    const res = await bulkExtendAccess(testDb, {
      actorId,
      userIds: [a1.id, a2.id, invited.id],
      days: 30,
    });
    expect(res.extended).toBe(2);
    expect(res.skipped).toBe(1);
    // Each extension is a discrete access grant → its own AccessExtension + audit.
    expect(await testDb.accessExtension.count()).toBe(2);
    expect(await testDb.auditLog.count({ where: { action: "access.extended" } })).toBe(2);
    // The expired student is reactivated.
    expect((await testDb.user.findUnique({ where: { id: a2.id } }))!.status).toBe("active");
  });

  it("grantFreeze raises freezes up to the cap, then no-ops", async () => {
    const s = await makeStudent("active", FUTURE);
    const r1 = await grantFreeze(testDb, { actorId, userId: s.id });
    expect(r1).toMatchObject({ ok: true, granted: true, freezes: 1 });
    const r2 = await grantFreeze(testDb, { actorId, userId: s.id });
    expect(r2).toMatchObject({ ok: true, granted: true, freezes: 2 });
    const r3 = await grantFreeze(testDb, { actorId, userId: s.id });
    expect(r3).toMatchObject({ ok: true, granted: false, freezes: 2 }); // cap 2
    // Two grants → two audit rows (the no-op writes none).
    expect(await testDb.auditLog.count({ where: { action: "streak.freeze_gifted" } })).toBe(2);
  });

  it("grantFreeze rejects a non-student", async () => {
    const mentor = await createTestUser({ email: "m@x.io", role: "mentor" });
    const res = await grantFreeze(testDb, { actorId, userId: mentor.id });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("bulkGrantFreeze grants to students only, one audit row with the count", async () => {
    const s1 = await makeStudent("active", FUTURE);
    const s2 = await makeStudent("active", FUTURE);
    const mentor = await createTestUser({ email: "m2@x.io", role: "mentor" });
    const res = await bulkGrantFreeze(testDb, {
      actorId,
      userIds: [s1.id, s2.id, mentor.id],
    });
    expect(res.granted).toBe(2);
    expect(res.skipped).toBe(1); // mentor filtered out
    const audits = await testDb.auditLog.findMany({ where: { action: "streak.bulk_freeze_gifted" } });
    expect(audits).toHaveLength(1);
    expect((audits[0]!.after as { granted: number }).granted).toBe(2);
  });
});
