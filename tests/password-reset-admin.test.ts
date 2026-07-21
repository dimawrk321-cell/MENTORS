import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { hashPassword } from "@/lib/utils/password";
import {
  adminIssuePasswordReset,
  isResetTokenValid,
  resetPassword,
  RESET_TOKEN_TTL_MS,
} from "@/lib/services/auth";

// Walk 12.3 P1: admin-issued reset link. Required coverage — invalidation of the
// previous token, the 1h TTL, and RBAC (the last lives in admin-rbac.test.ts).

const NOW = new Date("2026-07-21T12:00:00.000Z");
const tokenOf = (url: string) => url.split("/reset/")[1]!;

describe("adminIssuePasswordReset (P1)", () => {
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

  it("issues a valid 1h one-time link and writes an audit record (no token in it)", async () => {
    const a = await admin();
    const s = await student();
    const res = await adminIssuePasswordReset(testDb, { actorId: a.id, userId: s.id, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const token = tokenOf(res.resetUrl);
    expect(await isResetTokenValid(testDb, token, NOW)).toBe(true);

    const audit = await testDb.auditLog.findFirst({
      where: { action: "password_reset.issued", entityId: s.id },
    });
    expect(audit?.actorId).toBe(a.id);
    expect(JSON.stringify(audit)).not.toContain(token); // never persist the raw token
  });

  it("invalidates the previous unused reset token", async () => {
    const a = await admin();
    const s = await student();
    const first = await adminIssuePasswordReset(testDb, { actorId: a.id, userId: s.id, now: NOW });
    const second = await adminIssuePasswordReset(testDb, {
      actorId: a.id,
      userId: s.id,
      now: new Date(NOW.getTime() + 1000),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // Only one live token per user; the old link no longer works.
    expect(await isResetTokenValid(testDb, tokenOf(first.resetUrl), NOW)).toBe(false);
    expect(await isResetTokenValid(testDb, tokenOf(second.resetUrl), NOW)).toBe(true);
    const oldReset = await resetPassword(
      testDb,
      { token: tokenOf(first.resetUrl), password: "brand-new-pass" },
      NOW,
    );
    expect(oldReset.ok).toBe(false);
    // Exactly one unused reset row remains.
    expect(await testDb.passwordReset.count({ where: { userId: s.id, usedAt: null } })).toBe(1);
  });

  it("expires after the 1-hour TTL", async () => {
    const a = await admin();
    const s = await student();
    const res = await adminIssuePasswordReset(testDb, { actorId: a.id, userId: s.id, now: NOW });
    if (!res.ok) return;
    const token = tokenOf(res.resetUrl);
    const after = new Date(NOW.getTime() + RESET_TOKEN_TTL_MS + 1000);

    expect(await isResetTokenValid(testDb, token, after)).toBe(false);
    const late = await resetPassword(testDb, { token, password: "brand-new-pass" }, after);
    expect(late.ok).toBe(false);
  });

  it("only applies to activated students (active|expired), not invited/blocked/non-students", async () => {
    const a = await admin();
    const invited = await createTestUser({
      email: "inv@example.com",
      role: "student",
      status: "invited",
    });
    const blocked = await student({ email: "blk@example.com", status: "blocked" });
    const expired = await student({ email: "exp@example.com", status: "expired" });
    const mentor = await createTestUser({
      email: "men@example.com",
      role: "mentor",
      passwordHash: hash,
    });

    expect(
      (await adminIssuePasswordReset(testDb, { actorId: a.id, userId: invited.id, now: NOW })).ok,
    ).toBe(false);
    expect(
      (await adminIssuePasswordReset(testDb, { actorId: a.id, userId: blocked.id, now: NOW })).ok,
    ).toBe(false);
    expect(
      (await adminIssuePasswordReset(testDb, { actorId: a.id, userId: expired.id, now: NOW })).ok,
    ).toBe(true);

    const asMentor = await adminIssuePasswordReset(testDb, {
      actorId: a.id,
      userId: mentor.id,
      now: NOW,
    });
    expect(asMentor.ok).toBe(false);
    if (!asMentor.ok) expect(asMentor.code).toBe("not_found");
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
    const res = await adminIssuePasswordReset(testDb, { actorId: a.id, userId: s.id, now: NOW });
    expect(res.ok).toBe(true);
    // Sessions are revoked by setting revoked_at; a live count of 1 proves untouched.
    expect(await testDb.session.count({ where: { userId: s.id, revokedAt: null } })).toBe(1);
  });
});
