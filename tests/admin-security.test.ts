import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import {
  listActiveStudentSessions,
  listMultiDeviceStudents,
  listOpenSecurityFlags,
  listRecentPasswordResets,
  adminTerminateSession,
} from "@/lib/services/admin-security";

// D3 (spec 13.1): the /admin/security aggregates + single-session terminate.

const NOW = new Date("2026-07-22T12:00:00Z");
const FUTURE = new Date("2026-08-22T00:00:00Z");

let seq = 0;
async function makeStudent() {
  seq += 1;
  return testDb.user.create({
    data: { email: `s${seq}@x.io`, name: `S${seq}`, role: "student", status: "active", avatarColor: 0 },
  });
}
async function makeSession(userId: string, opts: { revoked?: boolean; impersonated?: boolean } = {}) {
  seq += 1;
  return testDb.session.create({
    data: {
      userId,
      tokenHash: `h${seq}`,
      ip: "1.2.3.4",
      expiresAt: FUTURE,
      lastActiveAt: NOW,
      revokedAt: opts.revoked ? NOW : null,
      impersonatorId: opts.impersonated ? userId : null,
    },
  });
}

describe("admin security aggregates (spec 13.1/D3)", () => {
  let actorId = "";
  beforeEach(async () => {
    await resetDb();
    seq = 0;
    actorId = (await createTestUser({ email: "owner@x.io", role: "owner" })).id;
  });

  it("listActiveStudentSessions returns only live, non-impersonation student sessions", async () => {
    const s1 = await makeStudent();
    await makeSession(s1.id);
    await makeSession(s1.id, { revoked: true }); // revoked → excluded
    await makeSession(s1.id, { impersonated: true }); // impersonation → excluded
    const mentor = await createTestUser({ email: "m@x.io", role: "mentor" });
    await makeSession(mentor.id); // non-student → excluded

    const { rows, total } = await listActiveStudentSessions(testDb, { now: NOW });
    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.studentId).toBe(s1.id);
    expect(rows[0]!.location).toBe("1.2.3.4");
  });

  it("adminTerminateSession revokes the session + audits", async () => {
    const s = await makeStudent();
    const session = await makeSession(s.id);
    const res = await adminTerminateSession(testDb, { actorId, sessionId: session.id, now: NOW });
    expect(res).toEqual({ ok: true });
    const after = await testDb.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.revokedAt).not.toBeNull();
    expect(await testDb.auditLog.count({ where: { action: "session.terminated" } })).toBe(1);
    // Second terminate is a no-op (already revoked).
    const again = await adminTerminateSession(testDb, { actorId, sessionId: session.id, now: NOW });
    expect(again).toEqual({ ok: false, code: "not_found" });
  });

  it("listOpenSecurityFlags returns only open flags", async () => {
    const s = await makeStudent();
    await testDb.securityFlag.create({
      data: { userId: s.id, type: "concurrent_geo", details: {}, status: "open" },
    });
    await testDb.securityFlag.create({
      data: { userId: s.id, type: "manual", details: {}, status: "resolved" },
    });
    const flags = await listOpenSecurityFlags(testDb);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.type).toBe("concurrent_geo");
  });

  it("listRecentPasswordResets merges self-serve rows and admin temp-resets", async () => {
    const s = await makeStudent();
    await testDb.passwordReset.create({
      data: { userId: s.id, token: "t1", expiresAt: FUTURE, createdAt: NOW },
    });
    await testDb.auditLog.create({
      data: {
        actorId,
        action: "password.reset_to_temp",
        entityType: "user",
        entityId: s.id,
        createdAt: NOW,
      },
    });
    const resets = await listRecentPasswordResets(testDb, { now: NOW });
    expect(resets).toHaveLength(2);
    expect(resets.map((r) => r.kind).sort()).toEqual(["admin", "self"]);
  });

  it("listMultiDeviceStudents flags a student with a new device + another", async () => {
    const s = await makeStudent();
    await testDb.device.create({
      data: { userId: s.id, fingerprintHash: "fp1", label: "Chrome", firstSeenAt: NOW, lastSeenAt: NOW },
    });
    const old = new Date("2026-01-01T00:00:00Z");
    await testDb.device.create({
      data: { userId: s.id, fingerprintHash: "fp2", label: "Safari", firstSeenAt: old, lastSeenAt: old },
    });
    // A single-device student is not flagged.
    const single = await makeStudent();
    await testDb.device.create({
      data: { userId: single.id, fingerprintHash: "fp3", label: "Edge", firstSeenAt: NOW, lastSeenAt: NOW },
    });

    const rows = await listMultiDeviceStudents(testDb, { now: NOW });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.studentId).toBe(s.id);
    expect(rows[0]!.devices).toHaveLength(2);
  });
});
