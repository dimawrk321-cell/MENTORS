import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { changeStudentEmail } from "@/lib/services/access";

// D2 (spec 13.1): change a student's login email — uniqueness, email_verified_at
// reset, audit, and sessions survive.

async function makeStudent(email: string) {
  return testDb.user.create({
    data: {
      email,
      name: "S",
      role: "student",
      status: "active",
      accessUntil: new Date("2027-01-01"),
      emailVerifiedAt: new Date("2026-01-01"),
      avatarColor: 0,
    },
  });
}

describe("changeStudentEmail (spec 13.1/D2)", () => {
  let actorId = "";
  beforeEach(async () => {
    await resetDb();
    actorId = (await createTestUser({ email: "owner@x.io", role: "owner" })).id;
  });

  it("changes email, clears email_verified_at, audits, keeps sessions", async () => {
    const student = await makeStudent("old@x.io");
    await testDb.session.create({
      data: {
        userId: student.id,
        tokenHash: "hash-1",
        ip: "127.0.0.1",
        expiresAt: new Date("2027-01-01"),
      },
    });

    const res = await changeStudentEmail(testDb, {
      actorId,
      userId: student.id,
      email: "new@x.io",
    });
    expect(res).toEqual({ ok: true, email: "new@x.io" });

    const after = await testDb.user.findUniqueOrThrow({ where: { id: student.id } });
    expect(after.email).toBe("new@x.io");
    expect(after.emailVerifiedAt).toBeNull();

    // Session untouched — a rename does not log the student out.
    expect(await testDb.session.count({ where: { userId: student.id } })).toBe(1);

    const audit = await testDb.auditLog.findFirst({ where: { action: "email.changed" } });
    expect(audit).not.toBeNull();
    expect((audit!.before as { email: string }).email).toBe("old@x.io");
    expect((audit!.after as { email: string }).email).toBe("new@x.io");
  });

  it("rejects a duplicate email", async () => {
    const a = await makeStudent("a@x.io");
    await makeStudent("b@x.io");
    const res = await changeStudentEmail(testDb, { actorId, userId: a.id, email: "b@x.io" });
    expect(res).toEqual({ ok: false, code: "exists" });
    // Original unchanged.
    expect((await testDb.user.findUniqueOrThrow({ where: { id: a.id } })).email).toBe("a@x.io");
  });

  it("rejects a non-student", async () => {
    const mentor = await createTestUser({ email: "m@x.io", role: "mentor" });
    const res = await changeStudentEmail(testDb, { actorId, userId: mentor.id, email: "z@x.io" });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("is a no-op when the email is unchanged", async () => {
    const s = await makeStudent("same@x.io");
    const res = await changeStudentEmail(testDb, { actorId, userId: s.id, email: "same@x.io" });
    expect(res).toEqual({ ok: true, email: "same@x.io" });
    // No audit for a no-op.
    expect(await testDb.auditLog.count({ where: { action: "email.changed" } })).toBe(0);
    // emailVerifiedAt preserved on a no-op.
    expect((await testDb.user.findUniqueOrThrow({ where: { id: s.id } })).emailVerifiedAt).not.toBeNull();
  });
});
