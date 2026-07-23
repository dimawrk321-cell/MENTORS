import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVITY_BAR_DAYS, getActivityBarData } from "@/lib/services/dashboard";
import { dateOnlyUtc, localDateStr } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Walk 13.4 block 2: activity bar (last 28 days, XP intensity). Обязательный тест —
// правая клетка = сегодня в TZ пользователя; граница суток; XP/действия по дню.

describe("getActivityBarData — полоса активности (spec 13.4 block 2)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("28 клеток, старое→новое, ровно одна today = правая, в TZ пользователя", async () => {
    const tz = "Europe/Moscow";
    const user = await createTestUser({ email: "a@test.local", timezone: tz });
    const now = new Date("2026-07-23T09:00:00.000Z");

    const data = await getActivityBarData(testDb, { userId: user.id, now, timezone: tz });

    expect(data.days).toHaveLength(ACTIVITY_BAR_DAYS);
    const last = data.days.at(-1)!;
    expect(last.date).toBe(localDateStr(now, tz)); // 2026-07-23
    expect(last.isToday).toBe(true);
    // today — единственная и именно последняя клетка.
    expect(data.days.filter((d) => d.isToday)).toHaveLength(1);
    // Даты строго возрастают слева направо.
    for (let i = 1; i < data.days.length; i += 1) {
      expect(data.days[i]!.date > data.days[i - 1]!.date).toBe(true);
    }
  });

  it("граница суток: 22:30 UTC — в TZ +03 уже следующий день → правая клетка локальная", async () => {
    const tz = "Europe/Moscow"; // UTC+3
    const user = await createTestUser({ email: "b@test.local", timezone: tz });
    // 2026-07-23T22:30:00Z → в Москве 2026-07-24 01:30 → «сегодня» = 24-е.
    const now = new Date("2026-07-23T22:30:00.000Z");

    const data = await getActivityBarData(testDb, { userId: user.id, now, timezone: tz });

    const last = data.days.at(-1)!;
    expect(last.date).toBe("2026-07-24");
    expect(last.isToday).toBe(true);
  });

  it("интенсивность по XP дня; действия из analytics_events; XP считается в TZ", async () => {
    const tz = "Europe/Moscow";
    const user = await createTestUser({ email: "c@test.local", timezone: tz });
    const now = new Date("2026-07-23T09:00:00.000Z");
    const todayStr = localDateStr(now, tz); // 2026-07-23
    const day = dateOnlyUtc(todayStr);

    // XP за сегодня: 30 (очередь) + 20 (урок) = 50 → ступень 3 (>=50, <100).
    await testDb.xpEvent.createMany({
      data: [
        {
          userId: user.id,
          type: "queue.completed",
          amount: 30,
          refType: "day",
          refId: todayStr,
          day,
        },
        {
          userId: user.id,
          type: "lesson.completed",
          amount: 20,
          refType: "lesson",
          refId: "L1",
          day,
        },
      ],
    });
    // Два действия за сегодня (activity-типы heatmap).
    await testDb.analyticsEvent.createMany({
      data: [
        { userId: user.id, type: "lesson.completed", payload: {}, createdAt: now },
        { userId: user.id, type: "card.reviewed", payload: {}, createdAt: now },
      ],
    });

    const data = await getActivityBarData(testDb, { userId: user.id, now, timezone: tz });
    const last = data.days.at(-1)!;
    expect(last.xp).toBe(50);
    expect(last.level).toBe(3);
    expect(last.actions).toBe(2);

    // Пустой вчерашний день — ступень 0.
    const yesterday = data.days.at(-2)!;
    expect(yesterday.xp).toBe(0);
    expect(yesterday.level).toBe(0);
  });
});
