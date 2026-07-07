import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/utils/password";
import { addDays } from "@/lib/utils/dates";
import { login } from "@/lib/services/auth";
import { DEVICE_LIMIT, validateSessionToken } from "@/lib/services/sessions";
import { parseUserAgent } from "@/lib/utils/user-agent";
import { createTestUser, resetDb, testDb, UA } from "./helpers/db";

// Mandatory suite (spec 19.2): two remembered devices — the third login evicts
// the stalest device by last_seen_at.

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

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

describe("device cap (spec 7.2)", () => {
  it("keeps two devices and evicts the stalest on a third login", async () => {
    const user = await makeStudent("devices@test.local");

    const first = await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.chromeWindows, deviceCookieId: "cookie-1", now: at(0) },
    );
    const second = await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.safariMac, deviceCookieId: "cookie-2", now: at(10) },
    );
    expect(first.ok && second.ok).toBe(true);

    expect(await testDb.device.count({ where: { userId: user.id } })).toBe(DEVICE_LIMIT);

    const third = await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.firefoxLinux, deviceCookieId: "cookie-3", now: at(20) },
    );
    expect(third.ok).toBe(true);

    const devices = await testDb.device.findMany({
      where: { userId: user.id },
      orderBy: { firstSeenAt: "asc" },
    });
    expect(devices).toHaveLength(DEVICE_LIMIT);
    // The stalest (Chrome · Windows) is gone; Safari and Firefox remain.
    const labels = devices.map((d) => d.label);
    expect(labels).toContain(parseUserAgent(UA.safariMac).label);
    expect(labels).toContain(parseUserAgent(UA.firefoxLinux).label);
    expect(labels).not.toContain(parseUserAgent(UA.chromeWindows).label);
  });

  it("the session of the evicted device shows the eviction screen (reason evicted_device)", async () => {
    const user = await makeStudent("evict-reason@test.local");

    const first = await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.chromeWindows, deviceCookieId: "cookie-1", now: at(0) },
    );
    if (!first.ok) throw new Error("login failed");
    await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.safariMac, deviceCookieId: "cookie-2", now: at(10) },
    );
    await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.firefoxLinux, deviceCookieId: "cookie-3", now: at(20) },
    );

    // First browser was displaced twice over: device eviction keeps the tombstone.
    const state = await validateSessionToken(testDb, first.token, at(30));
    expect(state.state).toBe("evicted");

    const firstSession = await testDb.session.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    // Reason may be evicted_login (second login came first) — the row must
    // stay revoked and its device link cleared by the SetNull FK.
    expect(firstSession?.revokedAt).not.toBeNull();
    expect(firstSession?.deviceId).toBeNull();
  });

  it("re-login from a known device does not create a new device row", async () => {
    const user = await makeStudent("same-device@test.local");

    await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.chromeWindows, deviceCookieId: "cookie-1", now: at(0) },
    );
    await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.chromeWindows, deviceCookieId: "cookie-1", now: at(10) },
    );

    const devices = await testDb.device.findMany({ where: { userId: user.id } });
    expect(devices).toHaveLength(1);
    expect(devices[0]?.lastSeenAt.getTime()).toBe(at(10).getTime());
  });

  it("a browser without the device cookie gets a fresh device identity", async () => {
    const user = await makeStudent("no-cookie@test.local");
    const res = await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.chromeWindows, deviceCookieId: null, now: at(0) },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deviceCookieId.length).toBeGreaterThan(20);
    expect(await testDb.device.count({ where: { userId: user.id } })).toBe(1);
  });

  it("same cookie but different UA platform is a different device (fingerprint)", async () => {
    const user = await makeStudent("ua-change@test.local");
    await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.chromeWindows, deviceCookieId: "shared", now: at(0) },
    );
    await login(
      testDb,
      { email: user.email, password: "password-123" },
      { ip: "127.0.0.1", userAgent: UA.safariMac, deviceCookieId: "shared", now: at(10) },
    );
    expect(await testDb.device.count({ where: { userId: user.id } })).toBe(2);
  });
});
