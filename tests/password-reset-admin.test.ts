import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { hashPassword, verifyPassword } from "@/lib/utils/password";
import { adminResetPasswordToTemp } from "@/lib/services/auth";
import { generateToken, sha256Hex } from "@/lib/utils/crypto";

// Walk 12.4/A2: admin password reset to a temporary password (replaces the
// link-based reset in the admin UI). Required coverage — the new temp password
// works and forces a change, the old one dies, no plaintext is audited, pending
// self-serve reset links are invalidated, sessions are untouched, and eligibility.

const NOW = new Date("2026-07-21T12:00:00.000Z");

describe("adminResetPasswordToTemp (12.4/A2)", () => {
  let hash: string;
  beforeAll(async () => {
    hash = await hashPassword("password-123");
  });
  beforeEach(async () => {
    await resetDb();
  });

  const admin = () => createTestUser({ email: "admin@example.com", role: "admin" });
  const student = (overrides: Record<string, unknown> = {}) =>
    createTestUser({
      email: "student@example.com",
      role: "student",
      status: "active",
      passwordHash: hash,
      activatedAt: NOW,
      accessUntil: new Date("2026-10-01T00:00:00.000Z"),
      ...overrides,
    });

  it("sets a working temp password + must_change_password, and kills the old one", async () => {
    const a = await admin();
    const s = await student();
    const res = await adminResetPasswordToTemp(testDb, { actorId: a.id, userId: s.id, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.tempPassword).toHaveLength(12);
    const fresh = await testDb.user.findUniqueOrThrow({ where: { id: s.id } });
    expect(fresh.mustChangePassword).toBe(true);
    // The revealed temp password verifies against the new hash; the old one does not.
    expect(await verifyPassword(fresh.passwordHash!, res.tempPassword)).toBe(true);
    expect(await verifyPassword(fresh.passwordHash!, "password-123")).toBe(false);
  });

  it("audits password.reset_to_temp without the plaintext", async () => {
    const a = await admin();
    const s = await student();
    const res = await adminResetPasswordToTemp(testDb, { actorId: a.id, userId: s.id, now: NOW });
    if (!res.ok) return;
    const audit = await testDb.auditLog.findFirst({
      where: { action: "password.reset_to_temp", entityId: s.id },
    });
    expect(audit?.actorId).toBe(a.id);
    expect(JSON.stringify(audit)).not.toContain(res.tempPassword);
  });

  it("invalidates the student's pending self-serve reset links", async () => {
    const a = await admin();
    const s = await student();
    const rawToken = generateToken();
    await testDb.passwordReset.create({
      data: {
        userId: s.id,
        token: sha256Hex(rawToken),
        expiresAt: new Date(NOW.getTime() + 3600_000),
        createdAt: NOW,
      },
    });
    await adminResetPasswordToTemp(testDb, { actorId: a.id, userId: s.id, now: NOW });
    // The outstanding link is marked used — no live reset token remains.
    expect(await testDb.passwordReset.count({ where: { userId: s.id, usedAt: null } })).toBe(0);
  });

  it("does not revoke the student's sessions", async () => {
    const a = await admin();
    const s = await student();
    const device = await testDb.device.create({
      data: { userId: s.id, fingerprintHash: "fp", label: "Chrome · macOS" },
    });
    await testDb.session.create({
      data: {
        userId: s.id,
        tokenHash: "session-hash",
        deviceId: device.id,
        ip: "127.0.0.1",
        expiresAt: new Date(NOW.getTime() + 30 * 24 * 3600 * 1000),
        lastActiveAt: NOW,
      },
    });
    await adminResetPasswordToTemp(testDb, { actorId: a.id, userId: s.id, now: NOW });
    expect(await testDb.session.count({ where: { userId: s.id, revokedAt: null } })).toBe(1);
  });

  it("eligibility: student with a password & not blocked; not invited-no-password/blocked/non-student", async () => {
    const a = await admin();
    const active = await student();
    const expired = await student({ email: "exp@example.com", status: "expired" });
    const invitedWithCreds = await student({
      email: "inv@example.com",
      status: "invited",
      mustChangePassword: true,
    });
    const invitedNoPassword = await createTestUser({
      email: "leg@example.com",
      role: "student",
      status: "invited",
      passwordHash: null,
    });
    const blocked = await student({ email: "blk@example.com", status: "blocked" });
    const mentor = await createTestUser({
      email: "men@example.com",
      role: "mentor",
      passwordHash: hash,
    });

    const ok = async (id: string) =>
      (await adminResetPasswordToTemp(testDb, { actorId: a.id, userId: id, now: NOW })).ok;

    expect(await ok(active.id)).toBe(true);
    expect(await ok(expired.id)).toBe(true);
    // A credential-created (still-invited) student can be re-issued a temp password.
    expect(await ok(invitedWithCreds.id)).toBe(true);
    // A legacy invited student without a password is not eligible (handled manually).
    expect(await ok(invitedNoPassword.id)).toBe(false);
    expect(await ok(blocked.id)).toBe(false);

    const asMentor = await adminResetPasswordToTemp(testDb, {
      actorId: a.id,
      userId: mentor.id,
      now: NOW,
    });
    expect(asMentor.ok).toBe(false);
    if (!asMentor.ok) expect(asMentor.code).toBe("not_found");
  });
});
