import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/utils/password";
import { addDays } from "@/lib/utils/dates";
import { changePassword, login, logout } from "@/lib/services/auth";
import { SESSION_TTL_MS, startImpersonation, validateSessionToken } from "@/lib/services/sessions";
import { createTestUser, resetDb, testDb, UA } from "./helpers/db";

// Mandatory suite (spec 19.2): single concurrent session — a new login
// displaces every other one, the displaced browser sees the eviction screen.

const NOW = new Date("2026-07-07T12:00:00.000Z");

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword("password-123");
});

beforeEach(async () => {
  await resetDb();
});

async function makeStudent(email: string) {
  return createTestUser({
    email,
    passwordHash,
    activatedAt: addDays(NOW, -10),
    accessUntil: addDays(NOW, 80),
  });
}

const ctx = (deviceCookieId: string | null, now: Date = NOW) => ({
  ip: "127.0.0.1",
  userAgent: UA.chromeWindows,
  deviceCookieId,
  now,
});

describe("single concurrent session (spec 7.2)", () => {
  it("second login evicts the first session; the evicted token maps to the eviction screen", async () => {
    const user = await makeStudent("solo@test.local");

    const first = await login(
      testDb,
      { email: user.email, password: "password-123" },
      ctx("dev-a"),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await login(
      testDb,
      { email: user.email, password: "password-123" },
      ctx("dev-b", new Date(NOW.getTime() + 60_000)),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Displaced request: the dedicated «Вход выполнен на другом устройстве» state.
    const evicted = await validateSessionToken(
      testDb,
      first.token,
      new Date(NOW.getTime() + 120_000),
    );
    expect(evicted.state).toBe("evicted");

    const alive = await validateSessionToken(
      testDb,
      second.token,
      new Date(NOW.getTime() + 120_000),
    );
    expect(alive.state).toBe("valid");

    // Exactly one live session remains.
    const liveSessions = await testDb.session.findMany({
      where: { userId: user.id, revokedAt: null },
    });
    expect(liveSessions).toHaveLength(1);

    // Forced termination is recorded for analytics (spec 7.13: session.evicted).
    const event = await testDb.analyticsEvent.findFirst({
      where: { type: "session.evicted", userId: user.id },
    });
    expect(event).not.toBeNull();
  });

  it("logout is a plain sign-out, not an eviction", async () => {
    const user = await makeStudent("logout@test.local");
    const res = await login(testDb, { email: user.email, password: "password-123" }, ctx("dev-a"));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const validation = await validateSessionToken(testDb, res.token, NOW);
    expect(validation.state).toBe("valid");
    if (validation.state !== "valid") return;

    await logout(testDb, validation.session, NOW);
    const after = await validateSessionToken(testDb, res.token, NOW);
    expect(after.state).toBe("none");
  });

  it("password change keeps the current session and drops the rest", async () => {
    const user = await makeStudent("pwd@test.local");
    const stale = await login(
      testDb,
      { email: user.email, password: "password-123" },
      ctx("dev-a"),
    );
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;

    // Same-device relogin replaces the session; now change the password from it.
    const current = await login(
      testDb,
      { email: user.email, password: "password-123" },
      ctx("dev-a", new Date(NOW.getTime() + 60_000)),
    );
    expect(current.ok).toBe(true);
    if (!current.ok) return;

    const validation = await validateSessionToken(
      testDb,
      current.token,
      new Date(NOW.getTime() + 120_000),
    );
    if (validation.state !== "valid") throw new Error("expected valid session");

    const changed = await changePassword(
      testDb,
      {
        user: validation.user,
        currentSessionId: validation.session.id,
        oldPassword: "password-123",
        newPassword: "new-password-456",
      },
      new Date(NOW.getTime() + 180_000),
    );
    expect(changed.ok).toBe(true);

    const still = await validateSessionToken(
      testDb,
      current.token,
      new Date(NOW.getTime() + 240_000),
    );
    expect(still.state).toBe("valid");
  });
});

describe("session validity (spec 7.2)", () => {
  it("expired-by-time session is invalid", async () => {
    const user = await makeStudent("ttl@test.local");
    const res = await login(testDb, { email: user.email, password: "password-123" }, ctx("dev-a"));
    if (!res.ok) throw new Error("login failed");

    const afterTtl = new Date(NOW.getTime() + SESSION_TTL_MS + 1000);
    expect((await validateSessionToken(testDb, res.token, afterTtl)).state).toBe("none");
  });

  it("activity rolls the 30-day window forward", async () => {
    const user = await makeStudent("rolling@test.local");
    const res = await login(testDb, { email: user.email, password: "password-123" }, ctx("dev-a"));
    if (!res.ok) throw new Error("login failed");

    const later = new Date(NOW.getTime() + 10 * 60_000); // > 5-минутного троттлинга
    const validation = await validateSessionToken(testDb, res.token, later);
    expect(validation.state).toBe("valid");

    const session = await testDb.session.findFirst({ where: { userId: user.id, revokedAt: null } });
    expect(session?.expiresAt.getTime()).toBe(later.getTime() + SESSION_TTL_MS);
    expect(session?.lastActiveAt.getTime()).toBe(later.getTime());
  });

  it("blocked user's session is dead even if the row survived", async () => {
    const user = await makeStudent("blocked-live@test.local");
    const res = await login(testDb, { email: user.email, password: "password-123" }, ctx("dev-a"));
    if (!res.ok) throw new Error("login failed");

    await testDb.user.update({ where: { id: user.id }, data: { status: "blocked" } });
    expect((await validateSessionToken(testDb, res.token, NOW)).state).toBe("none");
  });

  it("overdue active student validates with accessExpired=true (soft-lock)", async () => {
    const user = await createTestUser({
      email: "soft@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -100),
      accessUntil: addDays(NOW, 1),
    });
    const res = await login(testDb, { email: user.email, password: "password-123" }, ctx("dev-a"));
    if (!res.ok) throw new Error("login failed");

    const beforeEnd = await validateSessionToken(testDb, res.token, NOW);
    expect(beforeEnd.state === "valid" && beforeEnd.accessExpired).toBe(false);

    const afterEnd = await validateSessionToken(testDb, res.token, addDays(NOW, 2));
    expect(afterEnd.state === "valid" && afterEnd.accessExpired).toBe(true);
  });
});

describe("impersonation sessions (spec 7.2)", () => {
  it("student login does not evict an admin's impersonation view", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    const user = await makeStudent("watched@test.local");

    const imp = await startImpersonation(testDb, {
      actor: admin,
      targetUserId: user.id,
      ip: "127.0.0.1",
      now: NOW,
    });
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;

    const studentLogin = await login(
      testDb,
      { email: user.email, password: "password-123" },
      ctx("dev-a", new Date(NOW.getTime() + 60_000)),
    );
    expect(studentLogin.ok).toBe(true);

    const impState = await validateSessionToken(
      testDb,
      imp.token,
      new Date(NOW.getTime() + 120_000),
    );
    expect(impState.state).toBe("valid");
    if (impState.state !== "valid") return;
    expect(impState.session.impersonatorId).toBe(admin.id);

    // Audit trail for the impersonation start (spec 7.2).
    const audit = await testDb.auditLog.findFirst({
      where: { action: "impersonation.started", actorId: admin.id, entityId: user.id },
    });
    expect(audit).not.toBeNull();
  });
});
