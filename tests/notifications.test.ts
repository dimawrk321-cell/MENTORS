import { beforeEach, describe, expect, it } from "vitest";
import {
  getNotificationMatrix,
  getRecentNotifications,
  getUnreadCount,
  markNotificationsRead,
  MATRIX_ORDER,
  notify,
  resolveEffectivePref,
  updateNotificationPrefs,
} from "@/lib/services/notifications";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Стейдж 9 (spec 7.12/19): prefs-гейтинг («всегда»-типы не отключаются), тихие
// часы (границы/TZ — через notify), матрица профиля, колокольчик.

const MSK = "Europe/Moscow";
const msk = (iso: string) => new Date(`${iso}:00+03:00`);

beforeEach(async () => {
  await resetDb();
});

describe("prefs-гейтинг (spec 7.12)", () => {
  it("«всегда»-тип нельзя отключить строкой prefs", async () => {
    const u = await createTestUser({ email: "a1@test.local", timezone: MSK });
    await testDb.notificationPref.create({
      data: { userId: u.id, type: "mock_feedback", inapp: false, email: false },
    });
    // Строка игнорируется — always-on остаётся включённым.
    expect(await resolveEffectivePref(testDb, u.id, "mock_feedback")).toEqual({
      inapp: true,
      email: true,
    });
    await notify(
      testDb,
      u.id,
      "mock_feedback",
      { bookingId: "b1" },
      { now: msk("2026-07-15T12:00") },
    );
    const rows = await testDb.notification.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "mock_feedback", inApp: true, emailPending: true });
  });

  it("отключаемый тип с обоими выключенными каналами → доставки нет", async () => {
    const u = await createTestUser({ email: "a2@test.local", timezone: MSK });
    await testDb.notificationPref.create({
      data: { userId: u.id, type: "digest", inapp: false, email: false },
    });
    await notify(
      testDb,
      u.id,
      "digest",
      { count: 5, estimateMin: 3 },
      { now: msk("2026-07-15T12:00") },
    );
    expect(await testDb.notification.count({ where: { userId: u.id } })).toBe(0);
  });

  it("частичный выбор канала: inapp on, email off", async () => {
    const u = await createTestUser({ email: "a3@test.local", timezone: MSK });
    await testDb.notificationPref.create({
      data: { userId: u.id, type: "digest", inapp: true, email: false },
    });
    await notify(
      testDb,
      u.id,
      "digest",
      { count: 5, estimateMin: 3 },
      { now: msk("2026-07-15T12:00") },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "digest" } });
    expect(n).toMatchObject({ inApp: true, emailPending: false });
  });

  it("streak_risk — opt-in: по умолчанию молчит, включённый — доставляется", async () => {
    const u = await createTestUser({ email: "a4@test.local", timezone: MSK });
    await notify(testDb, u.id, "streak_risk", { current: 5 }, { now: msk("2026-07-15T20:30") });
    expect(await testDb.notification.count({ where: { userId: u.id } })).toBe(0);

    await testDb.notificationPref.create({
      data: { userId: u.id, type: "streak_risk", inapp: true, email: false },
    });
    await notify(testDb, u.id, "streak_risk", { current: 5 }, { now: msk("2026-07-15T20:30") });
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "streak_risk" } });
    expect(n).toMatchObject({ inApp: true, emailPending: false });
  });

  it("недоступный канал (lesson_new email) не включается даже строкой prefs", async () => {
    const u = await createTestUser({ email: "a5@test.local", timezone: MSK });
    await testDb.notificationPref.create({
      data: { userId: u.id, type: "lesson_new", inapp: true, email: true },
    });
    expect(await resolveEffectivePref(testDb, u.id, "lesson_new")).toEqual({
      inapp: true,
      email: false,
    });
  });
});

describe("тихие часы (spec 7.12)", () => {
  it("в тихие часы email откладывается до конца окна", async () => {
    const u = await createTestUser({ email: "q1@test.local", timezone: MSK }); // 22:00–08:00
    await notify(
      testDb,
      u.id,
      "access_14d",
      { untilText: "5 августа" },
      {
        now: msk("2026-07-15T23:00"),
      },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "access_14d" } });
    expect(n?.inApp).toBe(true); // in-app сразу
    expect(n?.emailPending).toBe(true);
    // конец тихих часов — 08:00 MSK следующего дня = 05:00 UTC
    expect(n?.scheduledAt?.toISOString()).toBe("2026-07-16T05:00:00.000Z");
  });

  it("срочные типы (mock_1h/mock_24h) в тихие часы: email отбрасывается, не откладывается", async () => {
    const u = await createTestUser({ email: "q5@test.local", timezone: MSK }); // 22:00–08:00
    const now = msk("2026-07-15T03:00"); // тихие часы
    await notify(
      testDb,
      u.id,
      "mock_1h",
      { bookingId: "b", whenText: "в 03:40" },
      { now, emailDeadline: msk("2026-07-15T03:40") },
    );
    const n = await testDb.notification.findFirst({ where: { userId: u.id, type: "mock_1h" } });
    expect(n?.inApp).toBe(true); // in-app остаётся
    expect(n?.emailPending).toBe(false); // email отброшен, не в очереди
    expect(n?.scheduledAt).toBeNull();
  });

  it("вне тихих часов email уходит сразу (scheduled = now)", async () => {
    const u = await createTestUser({ email: "q2@test.local", timezone: MSK });
    const now = msk("2026-07-15T12:00");
    await notify(testDb, u.id, "mock_feedback", { bookingId: "b" }, { now });
    const n = await testDb.notification.findFirst({ where: { userId: u.id } });
    expect(n?.scheduledAt?.getTime()).toBe(now.getTime());
  });

  it("окно тихих часов считается в TZ пользователя", async () => {
    // 06:00 UTC: MSK 09:00 (не тихо), NY 02:00 (тихо).
    const uMsk = await createTestUser({ email: "q3@test.local", timezone: MSK });
    const uNy = await createTestUser({ email: "q4@test.local", timezone: "America/New_York" });
    const now = new Date("2026-07-15T06:00:00Z");
    await notify(testDb, uMsk.id, "access_0d", { untilText: "сегодня" }, { now });
    await notify(testDb, uNy.id, "access_0d", { untilText: "сегодня" }, { now });
    const nMsk = await testDb.notification.findFirst({ where: { userId: uMsk.id } });
    const nNy = await testDb.notification.findFirst({ where: { userId: uNy.id } });
    expect(nMsk?.scheduledAt?.getTime()).toBe(now.getTime()); // сразу
    expect(nNy?.scheduledAt?.getTime()).toBeGreaterThan(now.getTime()); // отложено
  });
});

describe("матрица профиля (spec 8.3/7.12)", () => {
  it("только отключаемые типы; каналы по доступности", async () => {
    const u = await createTestUser({ email: "m1@test.local", timezone: MSK });
    const matrix = await getNotificationMatrix(testDb, u.id);
    expect(matrix.map((r) => r.type)).toEqual(MATRIX_ORDER);

    const digest = matrix.find((r) => r.type === "digest")!;
    expect(digest.inapp.shown).toBe(true);
    expect(digest.email.shown).toBe(true);

    const lessonNew = matrix.find((r) => r.type === "lesson_new")!;
    expect(lessonNew.inapp.shown).toBe(true);
    expect(lessonNew.email.shown).toBe(false);

    const risk = matrix.find((r) => r.type === "streak_risk")!;
    expect(risk.inapp.shown).toBe(true);
    expect(risk.inapp.value).toBe(false); // default off
    expect(risk.email.shown).toBe(false);
  });

  it("updateNotificationPrefs зажимает недоступные/всегда каналы", async () => {
    const u = await createTestUser({ email: "m2@test.local", timezone: MSK });
    await updateNotificationPrefs(testDb, u.id, { digest: { inapp: false, email: true } });
    expect(await resolveEffectivePref(testDb, u.id, "digest")).toEqual({
      inapp: false,
      email: true,
    });
    // email недоступен для lesson_new — зажимается в false несмотря на ввод.
    await updateNotificationPrefs(testDb, u.id, { lesson_new: { inapp: true, email: true } });
    expect(await resolveEffectivePref(testDb, u.id, "lesson_new")).toEqual({
      inapp: true,
      email: false,
    });
    // «всегда»-тип не в матрице → игнорируется (строка не пишется, доставка сохраняется).
    await updateNotificationPrefs(testDb, u.id, { mock_feedback: { inapp: false, email: false } });
    const row = await testDb.notificationPref.findUnique({
      where: { userId_type: { userId: u.id, type: "mock_feedback" } },
    });
    expect(row).toBeNull();
    expect(await resolveEffectivePref(testDb, u.id, "mock_feedback")).toEqual({
      inapp: true,
      email: true,
    });
  });
});

describe("колокольчик (spec 7.12)", () => {
  it("считает и показывает только in-app; email-only исключён; «прочитать все»", async () => {
    const u = await createTestUser({ email: "b1@test.local", timezone: MSK });
    const now = msk("2026-07-15T12:00");
    await notify(testDb, u.id, "mock_feedback", { bookingId: "b" }, { now });
    // email-only: digest с выключенным in-app
    await testDb.notificationPref.create({
      data: { userId: u.id, type: "digest", inapp: false, email: true },
    });
    await notify(testDb, u.id, "digest", { count: 1, estimateMin: 1 }, { now });

    expect(await getUnreadCount(testDb, u.id)).toBe(1);
    const recent = await getRecentNotifications(testDb, u.id);
    expect(recent.unread).toBe(1);
    expect(recent.items.every((i) => i.type !== "digest")).toBe(true);

    await markNotificationsRead(testDb, u.id, { all: true });
    expect(await getUnreadCount(testDb, u.id)).toBe(0);
  });
});
