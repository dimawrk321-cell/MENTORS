import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/utils/password";
import { addDays } from "@/lib/utils/dates";
import { login, requestPasswordReset } from "@/lib/services/auth";
import {
  AUTH_ATTEMPT_LIMIT,
  AUTH_ATTEMPT_WINDOW_MS,
  isAuthRateLimited,
  recordAuthAttempt,
} from "@/lib/utils/rate-limit";
import { createTestUser, resetDb, testDb, UA } from "./helpers/db";

// Mandatory suite (spec 19.2 via 7.2): /login and /forgot — 5 попыток / 15 мин
// на email+IP; таблица переживает рестарт, успех очищает бюджет.

const NOW = new Date("2026-07-07T12:00:00.000Z");

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword("password-123");
});

beforeEach(async () => {
  await resetDb();
});

const ctx = (now: Date = NOW) => ({
  ip: "127.0.0.1",
  userAgent: UA.chromeWindows,
  deviceCookieId: null,
  now,
});

async function makeStudent(email: string) {
  return createTestUser({
    email,
    passwordHash,
    activatedAt: addDays(NOW, -10),
    accessUntil: addDays(NOW, 80),
  });
}

describe("login rate limit (spec 7.2)", () => {
  it("blocks the 6th attempt even with the correct password", async () => {
    const user = await makeStudent("bruteforce@test.local");

    for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i += 1) {
      const attempt = await login(testDb, { email: user.email, password: "wrong-pass" }, ctx());
      expect(attempt).toEqual({ ok: false, code: "invalid_credentials" });
    }

    const sixth = await login(testDb, { email: user.email, password: "password-123" }, ctx());
    expect(sixth).toEqual({ ok: false, code: "rate_limited" });
  });

  it("a successful login clears the failure budget", async () => {
    const user = await makeStudent("recovers@test.local");

    for (let i = 0; i < AUTH_ATTEMPT_LIMIT - 1; i += 1) {
      await login(testDb, { email: user.email, password: "wrong-pass" }, ctx());
    }
    const success = await login(testDb, { email: user.email, password: "password-123" }, ctx());
    expect(success.ok).toBe(true);

    expect(await testDb.authAttempt.count({ where: { kind: "login", email: user.email } })).toBe(0);

    // Fresh budget: a new failure is again just an invalid-credentials answer.
    const after = await login(testDb, { email: user.email, password: "wrong-pass" }, ctx());
    expect(after).toEqual({ ok: false, code: "invalid_credentials" });
  });

  it("the 15-minute window slides: old failures stop counting", async () => {
    const email = "window@test.local";
    const ip = "10.0.0.1";
    for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i += 1) {
      await recordAuthAttempt(testDb, "login", email, ip, NOW);
    }
    expect(await isAuthRateLimited(testDb, "login", email, ip, NOW)).toBe(true);

    const later = new Date(NOW.getTime() + AUTH_ATTEMPT_WINDOW_MS + 1000);
    expect(await isAuthRateLimited(testDb, "login", email, ip, later)).toBe(false);
  });

  it("buckets are per email+IP: another IP is not affected", async () => {
    const email = "per-bucket@test.local";
    for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i += 1) {
      await recordAuthAttempt(testDb, "login", email, "10.0.0.1", NOW);
    }
    expect(await isAuthRateLimited(testDb, "login", email, "10.0.0.1", NOW)).toBe(true);
    expect(await isAuthRateLimited(testDb, "login", email, "10.0.0.2", NOW)).toBe(false);
  });

  it("unknown emails burn the same budget without leaking existence", async () => {
    for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i += 1) {
      const attempt = await login(
        testDb,
        { email: "ghost@test.local", password: "whatever-1" },
        ctx(),
      );
      expect(attempt).toEqual({ ok: false, code: "invalid_credentials" });
    }
    const sixth = await login(testDb, { email: "ghost@test.local", password: "whatever-1" }, ctx());
    expect(sixth).toEqual({ ok: false, code: "rate_limited" });
  });
});

describe("forgot rate limit (spec 7.2)", () => {
  it("every request consumes budget; the 6th is rejected", async () => {
    await makeStudent("forgot@test.local");

    for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i += 1) {
      const res = await requestPasswordReset(
        testDb,
        { email: "forgot@test.local" },
        { ip: "127.0.0.1", now: NOW },
      );
      expect(res.ok).toBe(true);
    }
    const sixth = await requestPasswordReset(
      testDb,
      { email: "forgot@test.local" },
      { ip: "127.0.0.1", now: NOW },
    );
    expect(sixth).toEqual({ ok: false, code: "rate_limited" });

    // 5 reset tokens were issued (the answer stays neutral either way).
    const user = await testDb.user.findUniqueOrThrow({ where: { email: "forgot@test.local" } });
    expect(await testDb.passwordReset.count({ where: { userId: user.id } })).toBe(
      AUTH_ATTEMPT_LIMIT,
    );
  });
});
