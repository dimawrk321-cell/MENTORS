import { beforeEach, describe, expect, it } from "vitest";
import { emitEvent } from "@/lib/services/events";
import { addDays, dateOnlyUtc, localDateStr } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Обязательный набор этапа 5 (spec 7.13/19): идемпотентность XP по каждому типу,
// гонка queue.completed (одна XP, один день в стрик), подавление дубля, ритуал
// уровня, интеграция вехи стрика через диспетчер.

const NOW = new Date("2026-07-13T12:00:00.000Z"); // Москва 15:00

beforeEach(async () => {
  await resetDb();
});

describe("XP-идемпотентность: двойной эмит = одна запись (spec 7.7/7.13)", () => {
  const cases = [
    {
      type: "lesson.completed",
      payload: { lessonId: "l1", moduleId: "m1", courseId: "c1" },
      xpType: "lesson.completed",
      amount: 20,
    },
    {
      type: "quiz.answered",
      payload: { questionId: "q1", first: true },
      xpType: "quiz.correct_first",
      amount: 5,
    },
    {
      type: "test.passed",
      payload: { moduleId: "m1", kind: "module", attemptNumber: 1, score: 80 },
      xpType: "test.passed",
      amount: 100,
    },
    { type: "testout.passed", payload: { moduleId: "m1" }, xpType: "testout.passed", amount: 100 },
    {
      type: "queue.completed",
      payload: { day: "2026-07-13" },
      xpType: "queue.completed",
      amount: 30,
    },
    { type: "mock.completed", payload: { bookingId: "b1" }, xpType: "mock.completed", amount: 200 },
  ];

  for (const testCase of cases) {
    it(`${testCase.type} → ровно одна запись xp_events (${testCase.xpType})`, async () => {
      const user = await createTestUser({ email: `${testCase.xpType}@test.local` });
      await emitEvent(testDb, testCase.type, testCase.payload, { userId: user.id, now: NOW });
      await emitEvent(testDb, testCase.type, testCase.payload, { userId: user.id, now: NOW });

      const rows = await testDb.xpEvent.findMany({
        where: { userId: user.id, type: testCase.xpType },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.amount).toBe(testCase.amount);
    });
  }

  it("test.passed_first_try (+50) начисляется один раз при повторном эмите", async () => {
    const user = await createTestUser({ email: "firsttry@test.local" });
    const payload = { moduleId: "m1", kind: "module", attemptNumber: 1, score: 80 };
    await emitEvent(testDb, "test.passed", payload, { userId: user.id, now: NOW });
    await emitEvent(testDb, "test.passed", payload, { userId: user.id, now: NOW });
    expect(
      await testDb.xpEvent.count({ where: { userId: user.id, type: "test.passed_first_try" } }),
    ).toBe(1);
  });

  it("разные ссылки/дни не дедуплицируются", async () => {
    const user = await createTestUser({ email: "distinct@test.local" });
    await emitEvent(testDb, "lesson.completed", { lessonId: "l1" }, { userId: user.id, now: NOW });
    await emitEvent(testDb, "lesson.completed", { lessonId: "l2" }, { userId: user.id, now: NOW });
    await emitEvent(
      testDb,
      "queue.completed",
      { day: "2026-07-13" },
      { userId: user.id, now: NOW },
    );
    await emitEvent(
      testDb,
      "queue.completed",
      { day: "2026-07-14" },
      {
        userId: user.id,
        now: addDays(NOW, 1),
      },
    );
    expect(
      await testDb.xpEvent.count({ where: { userId: user.id, type: "lesson.completed" } }),
    ).toBe(2);
    expect(
      await testDb.xpEvent.count({ where: { userId: user.id, type: "queue.completed" } }),
    ).toBe(2);
  });
});

describe("queue.completed exactly-once под гонкой (spec 7.13, закрытие ограничения этапа 4)", () => {
  it("две параллельные транзакции → одна XP, один analytics, один день в серию", async () => {
    const user = await createTestUser({ email: "race@test.local" });
    const day = localDateStr(NOW, user.timezone);

    const settled = await Promise.allSettled([
      testDb.$transaction((tx) =>
        emitEvent(tx, "queue.completed", { day }, { userId: user.id, now: NOW }),
      ),
      testDb.$transaction((tx) =>
        emitEvent(tx, "queue.completed", { day }, { userId: user.id, now: NOW }),
      ),
    ]);

    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    const recorded = fulfilled.filter((s) => s.status === "fulfilled" && s.value.recorded).length;
    expect(recorded).toBe(1); // ровно одна транзакция записала событие

    expect(
      await testDb.xpEvent.count({ where: { userId: user.id, type: "queue.completed" } }),
    ).toBe(1);
    expect(
      await testDb.analyticsEvent.count({ where: { userId: user.id, type: "queue.completed" } }),
    ).toBe(1);
    const streak = await testDb.streak.findUnique({ where: { userId: user.id } });
    expect(streak?.current).toBe(1); // день засчитан ровно один раз
  });

  it("повторное закрытие очереди в тот же день подавляется (recorded=false)", async () => {
    const user = await createTestUser({ email: "dup@test.local" });
    const day = localDateStr(NOW, user.timezone);
    const first = await emitEvent(
      testDb,
      "queue.completed",
      { day },
      { userId: user.id, now: NOW },
    );
    const second = await emitEvent(
      testDb,
      "queue.completed",
      { day },
      { userId: user.id, now: NOW },
    );
    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(
      await testDb.analyticsEvent.count({ where: { userId: user.id, type: "queue.completed" } }),
    ).toBe(1);
  });
});

describe("ритуал уровня и вехи стрика через диспетчер", () => {
  it("подъём уровня возвращается в результате эмита", async () => {
    const user = await createTestUser({ email: "levelup@test.local" });
    const first = await emitEvent(
      testDb,
      "test.passed",
      { moduleId: "m1", kind: "module", attemptNumber: 1, score: 80 },
      { userId: user.id, now: NOW },
    );
    expect(first.xpAwarded).toBe(150); // 100 + 50 first try
    expect(first.leveledUpTo).toBe(2); // 0 → 150 пересекает порог 100

    const second = await emitEvent(
      testDb,
      "test.passed",
      { moduleId: "m2", kind: "module", attemptNumber: 1, score: 80 },
      { userId: user.id, now: NOW },
    );
    expect(second.leveledUpTo).toBe(3); // 150 → 300 пересекает порог 215
  });

  it("веха 7 через qualifying-событие: +50 XP, достижение streak_7, +1 заморозка", async () => {
    const user = await createTestUser({ email: "milestone7@test.local" });
    const yesterday = dateOnlyUtc(localDateStr(addDays(NOW, -1), user.timezone));
    await testDb.streak.create({
      data: { userId: user.id, current: 6, best: 6, lastCountedDate: yesterday },
    });

    const day = localDateStr(NOW, user.timezone);
    const result = await emitEvent(
      testDb,
      "queue.completed",
      { day },
      { userId: user.id, now: NOW },
    );

    expect(result.xpAwarded).toBe(80); // 30 очередь + 50 веха
    expect(result.earnedAchievements.map((a) => a.key)).toContain("streak_7");
    const streak = await testDb.streak.findUnique({ where: { userId: user.id } });
    expect(streak?.current).toBe(7);
    expect(streak?.freezes).toBe(1);
    expect(
      await testDb.xpEvent.count({ where: { userId: user.id, type: "streak.milestone" } }),
    ).toBe(1);
  });
});
