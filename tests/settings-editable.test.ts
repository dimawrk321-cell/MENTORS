import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DIGEST_TIME_KEY,
  OPS_NEW_CARDS_PER_DAY_KEY,
  XP_MAP_SETTING_KEY,
  getDefaultDigestTime,
  getNumericSetting,
  getXpMap,
  upsertAppSetting,
} from "@/lib/services/settings";
import { DEFAULT_XP_MAP, planXp, xpAwardsForEvent } from "@/lib/services/xp";
import { emitEvent } from "@/lib/services/events";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Stage 12.1 (spec C1/C2): editable XP map + operational rules — app_settings-first
// with fallback to code constants, applied by services on the fly.

beforeEach(async () => {
  await resetDb();
});

async function admin() {
  return createTestUser({ email: "a@t.local", role: "admin" });
}

describe("getXpMap (spec 12.1/C1): app_settings → фоллбэк", () => {
  it("нет настройки → полностью дефолтная карта", async () => {
    expect(await getXpMap(testDb)).toEqual(DEFAULT_XP_MAP);
  });

  it("частичный override применяется, остальные — дефолт", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, {
      actorId: a.id,
      key: XP_MAP_SETTING_KEY,
      value: { "lesson.completed": 7, "mock.completed": 500 },
    });
    const map = await getXpMap(testDb);
    expect(map["lesson.completed"]).toBe(7);
    expect(map["mock.completed"]).toBe(500);
    expect(map["quiz.correct_first"]).toBe(DEFAULT_XP_MAP["quiz.correct_first"]);
  });

  it("невалидные значения (отрицательное / >10000 / дробное) → фоллбэк по ключу", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, {
      actorId: a.id,
      key: XP_MAP_SETTING_KEY,
      value: { "lesson.completed": -5, "test.passed": 99999, "queue.completed": 3.5 },
    });
    const map = await getXpMap(testDb);
    expect(map["lesson.completed"]).toBe(DEFAULT_XP_MAP["lesson.completed"]);
    expect(map["test.passed"]).toBe(DEFAULT_XP_MAP["test.passed"]);
    expect(map["queue.completed"]).toBe(DEFAULT_XP_MAP["queue.completed"]);
  });

  it("значение 0 сохраняется (граница диапазона)", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, {
      actorId: a.id,
      key: XP_MAP_SETTING_KEY,
      value: { "quiz.correct_first": 0 },
    });
    expect((await getXpMap(testDb))["quiz.correct_first"]).toBe(0);
  });
});

describe("xpAwardsForEvent/planXp применяют переданную карту (spec 12.1/C1)", () => {
  it("суммы берутся из карты, а не из констант", () => {
    const map = { ...DEFAULT_XP_MAP, "lesson.completed": 42 };
    const awards = xpAwardsForEvent("lesson.completed", { lessonId: "l1" }, map);
    expect(awards[0]!.amount).toBe(42);
    const plan = planXp("lesson.completed", { lessonId: "l1" }, map);
    expect(plan.primary!.amount).toBe(42);
  });

  it("без карты — дефолтные суммы (обратная совместимость)", () => {
    expect(xpAwardsForEvent("lesson.completed", { lessonId: "l1" })[0]!.amount).toBe(20);
  });
});

describe("emitEvent применяет редактируемую XP-карту (spec 12.1/C1: применение)", () => {
  it("override карты меняет начисленный XP; без override — дефолт", async () => {
    const user = await createTestUser({ email: "s@t.local" });
    const a = await admin();

    // Дефолт: lesson.completed = 20.
    const def = await emitEvent(
      testDb,
      "lesson.completed",
      { lessonId: "lx" },
      { userId: user.id },
    );
    expect(def.xpAwarded).toBe(20);

    // Override: 7. Новый урок (другой ref), чтобы не сработал дедуп.
    await upsertAppSetting(testDb, {
      actorId: a.id,
      key: XP_MAP_SETTING_KEY,
      value: { "lesson.completed": 7 },
    });
    const over = await emitEvent(
      testDb,
      "lesson.completed",
      { lessonId: "ly" },
      { userId: user.id },
    );
    expect(over.xpAwarded).toBe(7);

    const rows = await testDb.xpEvent.findMany({
      where: { userId: user.id, type: "lesson.completed" },
      orderBy: { refId: "asc" },
    });
    expect(rows.map((r) => [r.refId, r.amount])).toEqual([
      ["lx", 20],
      ["ly", 7],
    ]);
  });
});

describe("getNumericSetting (spec 12.1/C2): фоллбэк и применение", () => {
  const bounds = { min: 1, max: 500 };

  it("нет настройки → фоллбэк на константу", async () => {
    expect(await getNumericSetting(testDb, OPS_NEW_CARDS_PER_DAY_KEY, 20, bounds)).toBe(20);
  });

  it("валидное значение в диапазоне применяется", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, { actorId: a.id, key: OPS_NEW_CARDS_PER_DAY_KEY, value: 5 });
    expect(await getNumericSetting(testDb, OPS_NEW_CARDS_PER_DAY_KEY, 20, bounds)).toBe(5);
  });

  it("вне диапазона → фоллбэк", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, { actorId: a.id, key: OPS_NEW_CARDS_PER_DAY_KEY, value: 9999 });
    expect(await getNumericSetting(testDb, OPS_NEW_CARDS_PER_DAY_KEY, 20, bounds)).toBe(20);
  });

  it("нецелое → фоллбэк", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, { actorId: a.id, key: OPS_NEW_CARDS_PER_DAY_KEY, value: 3.5 });
    expect(await getNumericSetting(testDb, OPS_NEW_CARDS_PER_DAY_KEY, 20, bounds)).toBe(20);
  });
});

describe("getDefaultDigestTime (spec 12.1/C2)", () => {
  it("нет настройки → 09:00", async () => {
    expect(await getDefaultDigestTime(testDb)).toBe("09:00");
  });

  it("валидное HH:MM применяется", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, { actorId: a.id, key: DEFAULT_DIGEST_TIME_KEY, value: "07:30" });
    expect(await getDefaultDigestTime(testDb)).toBe("07:30");
  });

  it("невалидный формат → 09:00", async () => {
    const a = await admin();
    await upsertAppSetting(testDb, { actorId: a.id, key: DEFAULT_DIGEST_TIME_KEY, value: "25:99" });
    expect(await getDefaultDigestTime(testDb)).toBe("09:00");
  });
});
