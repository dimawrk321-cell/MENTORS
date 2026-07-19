import { beforeEach, describe, expect, it } from "vitest";
import {
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_RESEND_COOLDOWN_MS,
  EMAIL_CODE_TTL_MS,
  issueEmailCode,
  resendEmailCode,
  verifyEmailCode,
} from "@/lib/services/email-verification";
import { sha256Hex } from "@/lib/utils/crypto";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Soft email verification (spec 12.1/C8): одноразовость, TTL, лимит попыток,
// rate-limit resend. Codes are hashed; we seed a known hash to drive verify tests.

beforeEach(async () => {
  await resetDb();
});

const NOW = new Date("2026-07-20T10:00:00.000Z");

async function seedCode(
  userId: string,
  code: string,
  over: { expiresAt?: Date; attempts?: number } = {},
) {
  return testDb.emailVerification.create({
    data: {
      userId,
      codeHash: sha256Hex(code),
      expiresAt: over.expiresAt ?? new Date(NOW.getTime() + EMAIL_CODE_TTL_MS),
      attempts: over.attempts ?? 0,
    },
  });
}

describe("issueEmailCode", () => {
  it("создаёт хешированный код и заменяет предыдущий (один активный)", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    expect((await issueEmailCode(testDb, user.id, NOW)).ok).toBe(true);
    let rows = await testDb.emailVerification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).not.toMatch(/^\d{6}$/); // хеш, не открытый код

    // Повторная выдача (без кулдауна) заменяет строку.
    await issueEmailCode(testDb, user.id, new Date(NOW.getTime() + 5 * 60_000));
    rows = await testDb.emailVerification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("не выдаёт код уже подтверждённому", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    await testDb.user.update({ where: { id: user.id }, data: { emailVerifiedAt: NOW } });
    expect(await issueEmailCode(testDb, user.id, NOW)).toEqual({
      ok: false,
      code: "already_verified",
    });
  });
});

describe("verifyEmailCode — одноразовость", () => {
  it("верный код подтверждает почту и удаляет код; повторно — уже подтверждено", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    await seedCode(user.id, "123456");

    const first = await verifyEmailCode(testDb, user.id, "123456", NOW);
    expect(first.ok).toBe(true);
    const fresh = await testDb.user.findUnique({ where: { id: user.id } });
    expect(fresh?.emailVerifiedAt).not.toBeNull();
    expect(await testDb.emailVerification.count({ where: { userId: user.id } })).toBe(0);

    // Тот же код второй раз — почта уже подтверждена (код израсходован).
    const second = await verifyEmailCode(testDb, user.id, "123456", NOW);
    expect(second).toEqual({ ok: false, code: "already_verified" });
  });

  it("нет кода → no_code", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    expect(await verifyEmailCode(testDb, user.id, "123456", NOW)).toEqual({
      ok: false,
      code: "no_code",
    });
  });
});

describe("verifyEmailCode — TTL", () => {
  it("истёкший код → expired, почта не подтверждена", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    await seedCode(user.id, "123456", { expiresAt: new Date(NOW.getTime() - 1000) });
    expect(await verifyEmailCode(testDb, user.id, "123456", NOW)).toEqual({
      ok: false,
      code: "expired",
    });
    const fresh = await testDb.user.findUnique({ where: { id: user.id } });
    expect(fresh?.emailVerifiedAt).toBeNull();
  });
});

describe("verifyEmailCode — лимит попыток", () => {
  it("после 5 неверных попыток код блокируется (too_many), даже с верным кодом", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    await seedCode(user.id, "123456");

    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS; i += 1) {
      expect(await verifyEmailCode(testDb, user.id, "000000", NOW)).toEqual({
        ok: false,
        code: "invalid",
      });
    }
    // 6-я попытка — даже верный код не проходит.
    expect(await verifyEmailCode(testDb, user.id, "123456", NOW)).toEqual({
      ok: false,
      code: "too_many",
    });
    const fresh = await testDb.user.findUnique({ where: { id: user.id } });
    expect(fresh?.emailVerifiedAt).toBeNull();
  });
});

describe("resendEmailCode — rate-limit", () => {
  it("повторная выдача раньше кулдауна → cooldown; после — ok", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    expect((await issueEmailCode(testDb, user.id, NOW)).ok).toBe(true);

    // Сразу — кулдаун (строка только что создана).
    const soon = await resendEmailCode(testDb, user.id, new Date());
    expect(soon).toEqual({ ok: false, code: "cooldown" });

    // Спустя кулдаун — можно снова.
    const later = await resendEmailCode(
      testDb,
      user.id,
      new Date(Date.now() + EMAIL_CODE_RESEND_COOLDOWN_MS + 1000),
    );
    expect(later.ok).toBe(true);
  });
});
