import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { verifyPassword } from "@/lib/utils/password";
import {
  ACCESS_INITIAL_DAYS,
  buildCredentialMessage,
  createStudentCredentials,
} from "@/lib/services/access";
import { login, setInitialPassword } from "@/lib/services/auth";
import { validateSessionToken } from "@/lib/services/sessions";
import { addDays } from "@/lib/utils/dates";

// Walk 12.4/A: credential-based access issuance + activation on first login.

const NOW = new Date("2026-07-21T12:00:00.000Z");
const ctx = { ip: "127.0.0.1", userAgent: "Test/1.0", deviceCookieId: null, now: NOW };
const admin = () => createTestUser({ email: "admin@example.com", role: "admin" });

describe("createStudentCredentials (12.4/A1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates an invited student with a temp password, no invite row, no email, sections off", async () => {
    const a = await admin();
    const res = await createStudentCredentials(testDb, {
      actorId: a.id,
      email: "s@example.com",
      name: "",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const user = await testDb.user.findUniqueOrThrow({ where: { id: res.userId } });
    expect(user.status).toBe("invited");
    expect(user.mustChangePassword).toBe(true);
    expect(user.name).toBe("");
    expect(user.libraryEnabled).toBe(false);
    expect(user.activatedAt).toBeNull();
    expect(user.accessUntil).toBeNull();
    // The revealed temp password verifies against the stored hash.
    expect(res.tempPassword).toHaveLength(12);
    expect(await verifyPassword(user.passwordHash!, res.tempPassword)).toBe(true);
    // No invite row is created (credentials replace the invite flow).
    expect(await testDb.invite.count({ where: { email: "s@example.com" } })).toBe(0);
  });

  it("audits student.created without the plaintext password", async () => {
    const a = await admin();
    const res = await createStudentCredentials(testDb, {
      actorId: a.id,
      email: "s@example.com",
      name: "Алекс",
    });
    if (!res.ok) return;
    const audit = await testDb.auditLog.findFirst({
      where: { action: "student.created", entityId: res.userId },
    });
    expect(audit?.actorId).toBe(a.id);
    expect(JSON.stringify(audit)).not.toContain(res.tempPassword);
  });

  it("rejects a duplicate email", async () => {
    const a = await admin();
    await createStudentCredentials(testDb, { actorId: a.id, email: "s@example.com", name: "" });
    const dup = await createStudentCredentials(testDb, {
      actorId: a.id,
      email: "s@example.com",
      name: "",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("exists");
  });

  it("builds the copy-message with login and password", () => {
    const msg = buildCredentialMessage("s@example.com", "ABCdef23gh45");
    expect(msg).toContain("s@example.com");
    expect(msg).toContain("ABCdef23gh45");
    expect(msg).toContain("Логин");
  });
});

describe("first-login activation (12.4/A3)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function issued(email = "s@example.com") {
    const a = await admin();
    const res = await createStudentCredentials(testDb, { actorId: a.id, email, name: "" });
    if (!res.ok) throw new Error("issue failed");
    return { email, tempPassword: res.tempPassword, userId: res.userId };
  }

  it("first successful login activates (invited→active), starts the 90-day clock, keeps must_change", async () => {
    const { email, tempPassword } = await issued();
    const res = await login(testDb, { email, password: tempPassword }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const user = await testDb.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("active");
    expect(user.activatedAt).toEqual(NOW);
    expect(user.accessUntil).toEqual(addDays(NOW, ACCESS_INITIAL_DAYS));
    // Activation happens BEFORE the forced password change (DECISION).
    expect(user.mustChangePassword).toBe(true);
    // The session is valid immediately (validateSessionToken rejects `invited`).
    const v = await validateSessionToken(testDb, res.token, NOW);
    expect(v.state).toBe("valid");
  });

  it("a later login does not move activatedAt / accessUntil", async () => {
    const { email, tempPassword } = await issued();
    await login(testDb, { email, password: tempPassword }, ctx);
    const later = addDays(NOW, 1);
    const res2 = await login(testDb, { email, password: tempPassword }, { ...ctx, now: later });
    expect(res2.ok).toBe(true);
    const user = await testDb.user.findUniqueOrThrow({ where: { email } });
    expect(user.activatedAt).toEqual(NOW);
    expect(user.accessUntil).toEqual(addDays(NOW, ACCESS_INITIAL_DAYS));
  });
});

describe("setInitialPassword (12.4/A2)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sets the new password, clears must_change, revokes other sessions but keeps the current one", async () => {
    const user = await createTestUser({
      email: "s@example.com",
      role: "student",
      status: "active",
      mustChangePassword: true,
      activatedAt: NOW,
      accessUntil: addDays(NOW, ACCESS_INITIAL_DAYS),
    });
    const current = await testDb.session.create({
      data: {
        userId: user.id,
        tokenHash: "current-hash",
        ip: "127.0.0.1",
        expiresAt: addDays(NOW, 30),
        lastActiveAt: NOW,
      },
    });
    const other = await testDb.session.create({
      data: {
        userId: user.id,
        tokenHash: "other-hash",
        ip: "127.0.0.1",
        expiresAt: addDays(NOW, 30),
        lastActiveAt: NOW,
      },
    });

    await setInitialPassword(
      testDb,
      { user, currentSessionId: current.id, newPassword: "chosen-pass-9" },
      NOW,
    );

    const fresh = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.mustChangePassword).toBe(false);
    expect(await verifyPassword(fresh.passwordHash!, "chosen-pass-9")).toBe(true);
    // Current session survives; the other is revoked.
    expect(
      (await testDb.session.findUniqueOrThrow({ where: { id: current.id } })).revokedAt,
    ).toBeNull();
    expect(
      (await testDb.session.findUniqueOrThrow({ where: { id: other.id } })).revokedAt,
    ).not.toBeNull();
  });
});
