import { beforeEach, describe, expect, it } from "vitest";
import {
  cumulativeXpForLevel,
  getTodayXp,
  getTotalXp,
  levelForXp,
  xpAwardsForEvent,
  xpToNext,
} from "@/lib/services/xp";
import { emitEvent } from "@/lib/services/events";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Обязательный набор этапа 5 (spec 7.7/19): формула уровней (границы), XP-карта,
// дневная сумма в TZ (границы суток).

beforeEach(async () => {
  await resetDb();
});

describe("уровни: xp_to_next(L) = round(100 × 1.15^(L−1)), кумулятивно (spec 7.7)", () => {
  it("шаги и кумулятивные пороги совпадают с примером ТЗ", () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(115);
    expect(xpToNext(3)).toBe(132);
    // Кумулятив: L1→2: 100; →3: 215; →4: 347 (spec 7.7).
    expect(cumulativeXpForLevel(1)).toBe(0);
    expect(cumulativeXpForLevel(2)).toBe(100);
    expect(cumulativeXpForLevel(3)).toBe(215);
    expect(cumulativeXpForLevel(4)).toBe(347);
  });

  it("levelForXp на границах порогов", () => {
    expect(levelForXp(0).level).toBe(1);
    expect(levelForXp(99).level).toBe(1);
    expect(levelForXp(100).level).toBe(2);
    expect(levelForXp(214).level).toBe(2);
    expect(levelForXp(215).level).toBe(3);
    expect(levelForXp(346).level).toBe(3);
    expect(levelForXp(347).level).toBe(4);
  });

  it("прогресс внутри уровня и остаток до следующего", () => {
    const info = levelForXp(150); // уровень 2: [100, 215)
    expect(info.level).toBe(2);
    expect(info.levelFloor).toBe(100);
    expect(info.nextLevelAt).toBe(215);
    expect(info.intoLevel).toBe(50);
    expect(info.levelSpan).toBe(115);
    expect(info.toNext).toBe(65);
    expect(info.progress).toBeCloseTo(50 / 115);
  });
});

describe("XP-карта (spec 7.7, дословно)", () => {
  it("урок 20 / квиз-первый 5 / тест 100 (+50 первая попытка) / test-out 100", () => {
    expect(xpAwardsForEvent("lesson.completed", { lessonId: "l1" })).toEqual([
      { xpType: "lesson.completed", amount: 20, refType: "lesson", refId: "l1" },
    ]);
    expect(xpAwardsForEvent("quiz.answered", { questionId: "q1", first: true })).toEqual([
      { xpType: "quiz.correct_first", amount: 5, refType: "question", refId: "q1" },
    ]);
    expect(xpAwardsForEvent("quiz.answered", { questionId: "q1", first: false })).toEqual([]);
    expect(
      xpAwardsForEvent("test.passed", { moduleId: "m1", kind: "module", attemptNumber: 1 }),
    ).toEqual([
      { xpType: "test.passed", amount: 100, refType: "module", refId: "m1" },
      { xpType: "test.passed_first_try", amount: 50, refType: "module", refId: "m1" },
    ]);
    expect(
      xpAwardsForEvent("test.passed", { moduleId: "m1", kind: "module", attemptNumber: 2 }),
    ).toEqual([{ xpType: "test.passed", amount: 100, refType: "module", refId: "m1" }]);
    expect(xpAwardsForEvent("testout.passed", { moduleId: "m1" })).toEqual([
      { xpType: "testout.passed", amount: 100, refType: "module", refId: "m1" },
    ]);
  });

  it("очередь 30/день, мок 200/бронь, вехи 7/30/100 = 50/250/1000", () => {
    expect(xpAwardsForEvent("queue.completed", { day: "2026-07-13" })).toEqual([
      { xpType: "queue.completed", amount: 30, refType: "day", refId: "2026-07-13" },
    ]);
    expect(xpAwardsForEvent("mock.completed", { bookingId: "b1" })).toEqual([
      { xpType: "mock.completed", amount: 200, refType: "booking", refId: "b1" },
    ]);
    expect(xpAwardsForEvent("streak.milestone", { milestone: 7 })[0]?.amount).toBe(50);
    expect(xpAwardsForEvent("streak.milestone", { milestone: 30 })[0]?.amount).toBe(250);
    expect(xpAwardsForEvent("streak.milestone", { milestone: 100 })[0]?.amount).toBe(1000);
    // 365 — веха без XP (spec 7.7).
    expect(xpAwardsForEvent("streak.milestone", { milestone: 365 })).toEqual([]);
  });
});

describe("дневная сумма XP в TZ пользователя (spec 6/7.7)", () => {
  it("день начисления берётся по TZ — события у границы суток попадают в разные дни", async () => {
    const user = await createTestUser({ email: "tz@test.local", timezone: "Asia/Tokyo" });
    // Обе метки — 13 июля по UTC, но в Токио (UTC+9) это разные дни.
    const beforeMidnight = new Date("2026-07-13T14:00:00.000Z"); // Токио 13 июля 23:00
    const afterMidnight = new Date("2026-07-13T16:00:00.000Z"); // Токио 14 июля 01:00

    await emitEvent(
      testDb,
      "lesson.completed",
      { lessonId: "l1" },
      { userId: user.id, now: beforeMidnight },
    );
    await emitEvent(
      testDb,
      "lesson.completed",
      { lessonId: "l2" },
      { userId: user.id, now: afterMidnight },
    );

    expect(await getTotalXp(testDb, user.id)).toBe(40);
    // Кольцо цели считает только сегодняшний (локальный) день.
    expect(await getTodayXp(testDb, user.id, afterMidnight, "Asia/Tokyo")).toBe(20);
    expect(await getTodayXp(testDb, user.id, beforeMidnight, "Asia/Tokyo")).toBe(20);
  });
});
