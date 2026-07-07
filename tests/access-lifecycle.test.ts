import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/utils/password";
import { addDays, DAY_MS, zonedDateEndUtc } from "@/lib/utils/dates";
import {
  ACCESS_INITIAL_DAYS,
  computeExtendedAccessUntil,
  computeInitialAccessUntil,
  daysForTargetDate,
  expireOverdueAccess,
  extendAccess,
  inviteStudent,
  shouldExpire,
  blockStudent,
  unblockStudent,
  adminResetSessions,
} from "@/lib/services/access";
import { acceptInvite, login } from "@/lib/services/auth";
import { createSession } from "@/lib/services/sessions";
import { createTestUser, resetDb, testDb, UA } from "./helpers/db";

// Mandatory suite (spec 19.2): access lifecycle — activation +90, extension
// max(today, until)+term, expiry transition, block/unblock.

const NOW = new Date("2026-07-07T12:00:00.000Z");

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword("password-123");
});

beforeEach(async () => {
  await resetDb();
});

const ctx = (extra?: Partial<{ deviceCookieId: string | null }>) => ({
  ip: "127.0.0.1",
  userAgent: UA.chromeWindows,
  deviceCookieId: null,
  now: NOW,
  ...extra,
});

describe("pure date rules (spec 7.1)", () => {
  it("activation grants exactly 90 days", () => {
    expect(computeInitialAccessUntil(NOW).getTime()).toBe(
      NOW.getTime() + ACCESS_INITIAL_DAYS * DAY_MS,
    );
  });

  it("extension of a live access adds on top of access_until (dead days are not eaten)", () => {
    const current = addDays(NOW, 10);
    expect(computeExtendedAccessUntil(NOW, current, 30).getTime()).toBe(
      current.getTime() + 30 * DAY_MS,
    );
  });

  it("extension of an already expired access counts from today", () => {
    const past = addDays(NOW, -20);
    expect(computeExtendedAccessUntil(NOW, past, 30).getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
  });

  it("extension without prior access counts from today", () => {
    expect(computeExtendedAccessUntil(NOW, null, 90).getTime()).toBe(NOW.getTime() + 90 * DAY_MS);
  });

  it("«до даты» ends the chosen day in the student's timezone", () => {
    // Moscow is UTC+3: the 15th of August ends at 21:00 UTC.
    expect(zonedDateEndUtc("2026-08-15", "Europe/Moscow").toISOString()).toBe(
      "2026-08-15T21:00:00.000Z",
    );
  });

  it("daysForTargetDate rejects non-future targets", () => {
    const current = addDays(NOW, 10);
    expect(daysForTargetDate(NOW, current, addDays(NOW, 5))).toBeLessThanOrEqual(0);
    expect(daysForTargetDate(NOW, current, addDays(NOW, 15))).toBe(5);
  });

  it("shouldExpire only for active students past access_until", () => {
    const base = { role: "student" as const, status: "active" as const };
    expect(shouldExpire({ ...base, accessUntil: addDays(NOW, -1) }, NOW)).toBe(true);
    expect(shouldExpire({ ...base, accessUntil: addDays(NOW, 1) }, NOW)).toBe(false);
    expect(shouldExpire({ ...base, status: "blocked", accessUntil: addDays(NOW, -1) }, NOW)).toBe(
      false,
    );
    expect(shouldExpire({ ...base, role: "mentor", accessUntil: addDays(NOW, -1) }, NOW)).toBe(
      false,
    );
  });
});

describe("invite → activation (spec 7.1.1)", () => {
  it("activates with access_until = password setup + 90 days, not invite time", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    const invited = await inviteStudent(testDb, {
      actorId: admin.id,
      email: "student@test.local",
      name: "Студент",
      now: addDays(NOW, -5), // invite sent 5 days before activation
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const invite = await testDb.invite.findFirst({ where: { email: "student@test.local" } });
    const result = await acceptInvite(
      testDb,
      { token: invite!.token, password: "password-123" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user.status).toBe("active");
    expect(result.user.activatedAt?.getTime()).toBe(NOW.getTime());
    expect(result.user.accessUntil?.getTime()).toBe(NOW.getTime() + 90 * DAY_MS);

    const usedInvite = await testDb.invite.findUnique({ where: { id: invite!.id } });
    expect(usedInvite?.acceptedAt).not.toBeNull();

    // Second use of the same link is rejected.
    const again = await acceptInvite(
      testDb,
      { token: invite!.token, password: "password-123" },
      ctx(),
    );
    expect(again).toEqual({ ok: false, code: "used" });
  });

  it("expired invite token is rejected", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    await inviteStudent(testDb, {
      actorId: admin.id,
      email: "late@test.local",
      name: "Опоздавший",
      now: addDays(NOW, -8), // 7-day TTL passed
    });
    const invite = await testDb.invite.findFirst({ where: { email: "late@test.local" } });
    const result = await acceptInvite(
      testDb,
      { token: invite!.token, password: "password-123" },
      ctx(),
    );
    expect(result).toEqual({ ok: false, code: "expired" });
  });

  it("duplicate invite for an existing email is rejected", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    await createTestUser({ email: "taken@test.local", passwordHash });
    const result = await inviteStudent(testDb, {
      actorId: admin.id,
      email: "taken@test.local",
      name: "Дубль",
    });
    expect(result).toEqual({ ok: false, code: "exists" });
  });
});

describe("extension (spec 7.1.7)", () => {
  it("extends an expired student and reactivates the account", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    const student = await createTestUser({
      email: "expired@test.local",
      status: "expired",
      passwordHash,
      activatedAt: addDays(NOW, -100),
      accessUntil: addDays(NOW, -10),
    });

    const result = await extendAccess(testDb, {
      actorId: admin.id,
      userId: student.id,
      term: { kind: "days", days: 30 },
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Dead days are not eaten: counted from today, not from the old date.
    expect(result.newAccessUntil.getTime()).toBe(NOW.getTime() + 30 * DAY_MS);

    const fresh = await testDb.user.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.status).toBe("active");
    expect(fresh.accessUntil?.getTime()).toBe(NOW.getTime() + 30 * DAY_MS);

    const extension = await testDb.accessExtension.findFirst({ where: { userId: student.id } });
    expect(extension?.days).toBe(30);
    expect(extension?.grantedById).toBe(admin.id);

    const audit = await testDb.auditLog.findFirst({
      where: { action: "access.extended", entityId: student.id },
    });
    expect(audit?.actorId).toBe(admin.id);

    const event = await testDb.analyticsEvent.findFirst({
      where: { type: "access.extended", userId: student.id },
    });
    expect(event).not.toBeNull();
  });

  it("«до даты» sets access to the end of the chosen day in the student's tz", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    const student = await createTestUser({
      email: "until@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -10),
      accessUntil: addDays(NOW, 10),
      timezone: "Europe/Moscow",
    });

    const result = await extendAccess(testDb, {
      actorId: admin.id,
      userId: student.id,
      term: { kind: "until", date: "2026-08-15" },
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newAccessUntil.toISOString()).toBe("2026-08-15T21:00:00.000Z");
  });

  it("rejects a target date that is not after the current access end", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    const student = await createTestUser({
      email: "past-date@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -10),
      accessUntil: addDays(NOW, 30),
    });
    const result = await extendAccess(testDb, {
      actorId: admin.id,
      userId: student.id,
      term: { kind: "until", date: "2026-07-10" }, // before current access end
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "date_not_future" });
  });

  it("rejects extension of a not-yet-activated student", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    const invited = await createTestUser({ email: "invited@test.local", status: "invited" });
    const result = await extendAccess(testDb, {
      actorId: admin.id,
      userId: invited.id,
      term: { kind: "days", days: 30 },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, code: "not_activated" });
  });
});

describe("expiry (spec 7.1.5)", () => {
  it("worker flips only overdue active students", async () => {
    const overdue = await createTestUser({
      email: "over@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -91),
      accessUntil: addDays(NOW, -1),
    });
    const alive = await createTestUser({
      email: "alive@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -10),
      accessUntil: addDays(NOW, 80),
    });
    const mentor = await createTestUser({
      email: "mentor@test.local",
      role: "mentor",
      passwordHash,
      accessUntil: addDays(NOW, -1), // staff are never expired
    });

    const count = await expireOverdueAccess(testDb, NOW);
    expect(count).toBe(1);

    expect((await testDb.user.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe(
      "expired",
    );
    expect((await testDb.user.findUniqueOrThrow({ where: { id: alive.id } })).status).toBe(
      "active",
    );
    expect((await testDb.user.findUniqueOrThrow({ where: { id: mentor.id } })).status).toBe(
      "active",
    );

    const event = await testDb.analyticsEvent.findFirst({
      where: { type: "access.expired", userId: overdue.id },
    });
    expect(event).not.toBeNull();
  });

  it("login of an overdue active student flips the status lazily", async () => {
    await createTestUser({
      email: "lazy@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -100),
      accessUntil: addDays(NOW, -2),
    });
    const result = await login(
      testDb,
      { email: "lazy@test.local", password: "password-123" },
      ctx(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.status).toBe("expired");
    const fresh = await testDb.user.findUniqueOrThrow({ where: { email: "lazy@test.local" } });
    expect(fresh.status).toBe("expired");
  });
});

describe("block / unblock / admin reset (spec 7.1.8)", () => {
  it("block instantly revokes every session and unblock restores by dates", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    const student = await createTestUser({
      email: "victim@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -10),
      accessUntil: addDays(NOW, 80),
    });
    await createSession(testDb, { userId: student.id, deviceId: null, ip: "127.0.0.1", now: NOW });

    const blocked = await blockStudent(testDb, { actorId: admin.id, userId: student.id, now: NOW });
    expect(blocked.ok).toBe(true);

    const sessions = await testDb.session.findMany({ where: { userId: student.id } });
    expect(sessions.every((s) => s.revokedAt !== null && s.revokedReason === "blocked")).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: student.id } })).status).toBe(
      "blocked",
    );

    const unblocked = await unblockStudent(testDb, {
      actorId: admin.id,
      userId: student.id,
      now: NOW,
    });
    expect(unblocked.ok).toBe(true);
    // Access still in the future → active again.
    expect((await testDb.user.findUniqueOrThrow({ where: { id: student.id } })).status).toBe(
      "active",
    );
  });

  it("admin reset drops sessions and forgets devices", async () => {
    const admin = await createTestUser({ email: "admin@test.local", role: "admin", passwordHash });
    await createTestUser({
      email: "reset@test.local",
      passwordHash,
      activatedAt: addDays(NOW, -10),
      accessUntil: addDays(NOW, 80),
    });
    await login(testDb, { email: "reset@test.local", password: "password-123" }, ctx());
    const student = await testDb.user.findUniqueOrThrow({ where: { email: "reset@test.local" } });

    const result = await adminResetSessions(testDb, {
      actorId: admin.id,
      userId: student.id,
      now: NOW,
    });
    expect(result.ok).toBe(true);

    const live = await testDb.session.findMany({ where: { userId: student.id, revokedAt: null } });
    expect(live).toHaveLength(0);
    expect(await testDb.device.count({ where: { userId: student.id } })).toBe(0);
  });
});
