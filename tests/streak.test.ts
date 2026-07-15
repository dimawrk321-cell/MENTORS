import { beforeEach, describe, expect, it } from "vitest";
import {
  countStreakDay,
  getStreakState,
  pauseStreak,
  processStreakDay,
  unpauseStreak,
} from "@/lib/services/streak";
import { addDays, dateOnlyUtc, isoWeekday, localDateStr } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Обязательный набор этапа 5 (spec 7.7/19): учебные дни, заморозка (+1/7, cap 2,
// автосписание), обнуление без заморозки, paused, вехи.

const TZ = "Europe/Moscow"; // UTC+3, без DST

/** UTC-инстант, соответствующий локальному часу H даты dateStr в Москве (H ≥ 3). */
function at(dateStr: string, hour = 12): Date {
  const utcHour = String(hour - 3).padStart(2, "0");
  return new Date(`${dateStr}T${utcHour}:00:00.000Z`);
}

function dayStr(base: string, offset: number): string {
  return localDateStr(addDays(dateOnlyUtc(base), offset), "UTC");
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

beforeEach(async () => {
  await resetDb();
});

describe("countStreakDay: засчёт дня (spec 7.7)", () => {
  it("первый день → current 1; повтор в тот же день — no-op", async () => {
    const user = await createTestUser({ email: "s1@test.local", timezone: TZ });
    const first = await countStreakDay(testDb, { userId: user.id, now: at("2026-07-13") });
    expect(first).toMatchObject({ counted: true, current: 1 });

    const again = await countStreakDay(testDb, { userId: user.id, now: at("2026-07-13", 20) });
    expect(again).toMatchObject({ counted: false, current: 1 });

    const streak = await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streak).toMatchObject({ current: 1, best: 1 });
  });

  it("подряд идущие учебные дни наращивают серию", async () => {
    const user = await createTestUser({ email: "s2@test.local", timezone: TZ });
    await countStreakDay(testDb, { userId: user.id, now: at("2026-07-13") });
    await countStreakDay(testDb, { userId: user.id, now: at("2026-07-14") });
    const third = await countStreakDay(testDb, { userId: user.id, now: at("2026-07-15") });
    expect(third.current).toBe(3);
  });

  it("исключённый (не учебный) день прозрачен — не считается и не рвёт", async () => {
    const excluded = isoWeekday("2026-07-14");
    const studyDays = ALL_DAYS.filter((d) => d !== excluded);
    const user = await createTestUser({ email: "s3@test.local", timezone: TZ, studyDays });

    await countStreakDay(testDb, { userId: user.id, now: at("2026-07-13") });
    const onExcluded = await countStreakDay(testDb, { userId: user.id, now: at("2026-07-14") });
    expect(onExcluded.counted).toBe(false); // не учебный день

    const next = await countStreakDay(testDb, { userId: user.id, now: at("2026-07-15") });
    expect(next.current).toBe(2); // 07-13 и 07-15; 07-14 пропущен прозрачно
  });

  it("заморозки: +1 за 7 подряд, cap 2; веха 7 достигнута", async () => {
    const user = await createTestUser({ email: "s4@test.local", timezone: TZ });
    let last = await countStreakDay(testDb, { userId: user.id, now: at(dayStr("2026-07-13", 0)) });
    for (let i = 1; i < 7; i += 1) {
      last = await countStreakDay(testDb, { userId: user.id, now: at(dayStr("2026-07-13", i)) });
    }
    expect(last.current).toBe(7);
    expect(last.milestonesReached).toEqual([7]);
    expect((await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } })).freezes).toBe(1);

    for (let i = 7; i < 14; i += 1) {
      await countStreakDay(testDb, { userId: user.id, now: at(dayStr("2026-07-13", i)) });
    }
    expect((await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } })).freezes).toBe(2);

    // 15..21 день — заморозки уже на cap 2, новых не добавляется.
    for (let i = 14; i < 21; i += 1) {
      last = await countStreakDay(testDb, { userId: user.id, now: at(dayStr("2026-07-13", i)) });
    }
    expect(last.current).toBe(21);
    expect((await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } })).freezes).toBe(2);
  });

  it("вехи 30 / 100 / 365 эмитятся при достижении", async () => {
    for (const milestone of [30, 100, 365]) {
      const user = await createTestUser({ email: `ms${milestone}@test.local`, timezone: TZ });
      await testDb.streak.create({
        data: {
          userId: user.id,
          current: milestone - 1,
          best: milestone - 1,
          lastCountedDate: dateOnlyUtc("2026-07-12"),
        },
      });
      const result = await countStreakDay(testDb, { userId: user.id, now: at("2026-07-13") });
      expect(result.milestonesReached).toEqual([milestone]);
    }
  });
});

describe("processStreakDay: конец дня — заморозка / обнуление (spec 7.7)", () => {
  it("пропущенный учебный день тратит заморозку, серия сохранена", async () => {
    const user = await createTestUser({ email: "f1@test.local", timezone: TZ });
    await testDb.streak.create({
      data: {
        userId: user.id,
        current: 5,
        best: 5,
        freezes: 1,
        lastCountedDate: dateOnlyUtc("2026-07-13"),
      },
    });

    await processStreakDay(testDb, { userId: user.id, now: at("2026-07-15") });

    const streak = await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streak.current).toBe(5); // сохранена
    expect(streak.freezes).toBe(0); // списана
    expect(localDateStr(streak.lastCountedDate!, "UTC")).toBe("2026-07-14"); // цепочка с покрытого дня
    expect(
      await testDb.streakEvent.count({ where: { userId: user.id, kind: "freeze_used" } }),
    ).toBe(1);
  });

  it("пропуск без заморозки обнуляет серию", async () => {
    const user = await createTestUser({ email: "f2@test.local", timezone: TZ });
    await testDb.streak.create({
      data: {
        userId: user.id,
        current: 5,
        best: 5,
        freezes: 0,
        lastCountedDate: dateOnlyUtc("2026-07-13"),
      },
    });

    await processStreakDay(testDb, { userId: user.id, now: at("2026-07-15") });

    const streak = await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streak.current).toBe(0);
    expect(streak.lastCountedDate).toBeNull();
    expect(await testDb.streakEvent.count({ where: { userId: user.id, kind: "reset" } })).toBe(1);
  });

  it("paused: дни не считаются и серия не сгорает (spec 7.1.5)", async () => {
    const user = await createTestUser({ email: "p1@test.local", timezone: TZ });
    await testDb.streak.create({
      data: {
        userId: user.id,
        current: 5,
        best: 5,
        paused: true,
        lastCountedDate: dateOnlyUtc("2026-07-13"),
      },
    });

    const counted = await countStreakDay(testDb, { userId: user.id, now: at("2026-07-14") });
    expect(counted.counted).toBe(false);
    await processStreakDay(testDb, { userId: user.id, now: at("2026-07-20") });

    const streak = await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streak.current).toBe(5); // не сгорела
  });

  it("pauseStreak на несуществующей серии — no-op без ошибки", async () => {
    const user = await createTestUser({ email: "p2@test.local", timezone: TZ });
    await expect(pauseStreak(testDb, user.id)).resolves.toBeUndefined();
  });

  it("unpauseStreak сохраняет серию после продления — не догоняет замороженный интервал (spec 7.1.7)", async () => {
    const user = await createTestUser({ email: "unp@test.local", timezone: TZ });
    // Живая серия 50 (+2 заморозки), поставленная на паузу истечением месяц назад.
    await testDb.streak.create({
      data: {
        userId: user.id,
        current: 50,
        best: 50,
        freezes: 2,
        paused: true,
        lastCountedDate: dateOnlyUtc("2026-06-01"),
      },
    });

    // Продление через месяц простоя.
    await unpauseStreak(testDb, user.id, at("2026-07-05"));
    let streak = await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streak.paused).toBe(false);
    expect(streak.current).toBe(50); // «всё на месте»
    expect(streak.freezes).toBe(2); // заморозки не сгорели
    expect(localDateStr(streak.lastCountedDate!, "UTC")).toBe("2026-07-05"); // якорь — день продления

    // Первый визит после продления не обнуляет сохранённую серию.
    await processStreakDay(testDb, { userId: user.id, now: at("2026-07-05", 22) });
    streak = await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streak.current).toBe(50);
    expect(streak.freezes).toBe(2);
  });

  it("гонка двух первых событий нового пользователя не роняет действие; день засчитан один раз", async () => {
    const user = await createTestUser({ email: "conc@test.local", timezone: TZ });
    // ensureStreak через upsert (ON CONFLICT DO UPDATE) не отравляет транзакцию
    // вызывающего действия; строчная блокировка сериализует засчёт дня.
    const settled = await Promise.allSettled([
      testDb.$transaction((tx) => countStreakDay(tx, { userId: user.id, now: at("2026-07-13") })),
      testDb.$transaction((tx) => countStreakDay(tx, { userId: user.id, now: at("2026-07-13") })),
    ]);
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true);
    const streak = await testDb.streak.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streak.current).toBe(1);
    expect(await testDb.streakEvent.count({ where: { userId: user.id, kind: "counted" } })).toBe(1);
  });
});

describe("getStreakState: «под угрозой» (spec 5.3/8.3)", () => {
  it("после 20:00, день не засчитан, серия ≥3 → atRisk", async () => {
    const user = await createTestUser({ email: "r1@test.local", timezone: TZ });
    await testDb.streak.create({
      data: { userId: user.id, current: 3, best: 3, lastCountedDate: dateOnlyUtc("2026-07-12") },
    });

    const late = await getStreakState(testDb, {
      userId: user.id,
      now: at("2026-07-13", 21),
      timezone: TZ,
      studyDays: ALL_DAYS,
    });
    expect(late.atRisk).toBe(true);
    expect(late.todayCounted).toBe(false);

    const early = await getStreakState(testDb, {
      userId: user.id,
      now: at("2026-07-13", 10),
      timezone: TZ,
      studyDays: ALL_DAYS,
    });
    expect(early.atRisk).toBe(false);
  });
});
