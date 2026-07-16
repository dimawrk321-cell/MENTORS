import { beforeEach, describe, expect, it } from "vitest";
import {
  computeTargetSlots,
  effectiveWindowsForDate,
  generateSlots,
  gridStartsForWindow,
  minutesToTime,
  parseTimeToMinutes,
} from "@/lib/services/slots";
import { getAvailableSlots } from "@/lib/services/mock-queries";
import { zonedDateTimeToUtc } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { createInterviewer, createSlot } from "./helpers/mocks";

// Обязательный набор этапа 6: генерация слотов (spec 7.8) — сетка 75, исключения,
// идемпотентность, только будущие, отображение в TZ.

const MSK = "Europe/Moscow";
// Среда, 8 июля 2026, 15:00 МСК (12:00 UTC).
const NOW = new Date("2026-07-08T12:00:00.000Z");

describe("сетка слотов — чистое ядро (spec 7.8)", () => {
  it("нарезает окно с шагом 75 мин, пока start + 60 ≤ end (18:00–21:00 → 18:00, 19:15)", () => {
    // 18:00 = 1080, 21:00 = 1260.
    expect(gridStartsForWindow({ startMinutes: 1080, endMinutes: 1260 })).toEqual([1080, 1155]);
  });

  it("окно ровно на один слот (18:00–19:00) даёт один старт", () => {
    expect(gridStartsForWindow({ startMinutes: 1080, endMinutes: 1140 })).toEqual([1080]);
  });

  it("окно короче 60 мин слотов не даёт", () => {
    expect(gridStartsForWindow({ startMinutes: 1080, endMinutes: 1130 })).toEqual([]);
  });

  it("три слота: 18:00–21:30 → 18:00, 19:15, 20:30", () => {
    // 21:30 = 1290; 20:30 (1230) заканчивается в 21:30 ровно, укладывается.
    expect(gridStartsForWindow({ startMinutes: 1080, endMinutes: 1290 })).toEqual([
      1080, 1155, 1230,
    ]);
  });

  it("parseTimeToMinutes / minutesToTime — обратимы и валидируют формат", () => {
    expect(parseTimeToMinutes("19:15")).toBe(1155);
    expect(minutesToTime(1155)).toBe("19:15");
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("9:5")).toBeNull();
  });
});

describe("эффективные окна дня — правила и исключения (spec 7.8)", () => {
  const rules = [{ weekday: 3, startTime: "18:00", endTime: "21:00", active: true }];

  it("правило применяется в свой день недели", () => {
    // 2026-07-08 — среда (weekday 3).
    expect(effectiveWindowsForDate("2026-07-08", rules, [])).toEqual([
      { startMinutes: 1080, endMinutes: 1260 },
    ]);
    // 2026-07-09 — четверг: правила нет.
    expect(effectiveWindowsForDate("2026-07-09", rules, [])).toEqual([]);
  });

  it("day_off снимает повторяющиеся правила на дату", () => {
    const exceptions = [
      {
        date: new Date("2026-07-08T00:00:00.000Z"),
        kind: "day_off" as const,
        startTime: null,
        endTime: null,
      },
    ];
    expect(effectiveWindowsForDate("2026-07-08", rules, exceptions)).toEqual([]);
  });

  it("extra добавляет окно на конкретную дату (в день без правила)", () => {
    const exceptions = [
      {
        date: new Date("2026-07-09T00:00:00.000Z"),
        kind: "extra" as const,
        startTime: "10:00",
        endTime: "11:30",
      },
    ];
    expect(effectiveWindowsForDate("2026-07-09", rules, exceptions)).toEqual([
      { startMinutes: 600, endMinutes: 690 },
    ]);
  });

  it("day_off — весь день выходной: отменяет и правило, и extra на эту дату", () => {
    const exceptions = [
      {
        date: new Date("2026-07-08T00:00:00.000Z"),
        kind: "day_off" as const,
        startTime: null,
        endTime: null,
      },
      {
        date: new Date("2026-07-08T00:00:00.000Z"),
        kind: "extra" as const,
        startTime: "10:00",
        endTime: "11:30",
      },
    ];
    expect(effectiveWindowsForDate("2026-07-08", rules, exceptions)).toEqual([]);
  });
});

describe("computeTargetSlots — только будущие, дедуп, TZ (spec 7.8)", () => {
  it("материализует слоты правила в UTC-инстанты локального времени интервьюера", () => {
    const rules = [{ weekday: 4, startTime: "18:00", endTime: "21:00", active: true }];
    const targets = computeTargetSlots({ timezone: MSK, now: NOW, rules, exceptions: [] });
    // Ближайший четверг — 2026-07-09; 18:00 и 19:15 МСК.
    const expected1 = zonedDateTimeToUtc("2026-07-09", "18:00", MSK);
    const expected2 = zonedDateTimeToUtc("2026-07-09", "19:15", MSK);
    const starts = targets.map((t) => t.startsAt.getTime());
    expect(starts).toContain(expected1.getTime());
    expect(starts).toContain(expected2.getTime());
    // 18:00 МСК = 15:00 UTC (летом MSK = UTC+3).
    expect(expected1.toISOString()).toBe("2026-07-09T15:00:00.000Z");
  });

  it("сегодняшние прошедшие старты отбрасываются (только будущие)", () => {
    // Правило на среду (сегодня) 10:00–13:00 — все старты уже прошли (сейчас 15:00 МСК).
    const rules = [{ weekday: 3, startTime: "10:00", endTime: "13:00", active: true }];
    const targets = computeTargetSlots({ timezone: MSK, now: NOW, rules, exceptions: [] });
    const todayStarts = targets.filter(
      (t) => t.startsAt.toISOString().slice(0, 10) === "2026-07-08",
    );
    expect(todayStarts).toHaveLength(0);
  });

  it("длительность слота — 60 мин", () => {
    const rules = [{ weekday: 4, startTime: "18:00", endTime: "19:00", active: true }];
    const [slot] = computeTargetSlots({ timezone: MSK, now: NOW, rules, exceptions: [] });
    expect(slot!.endsAt.getTime() - slot!.startsAt.getTime()).toBe(60 * 60 * 1000);
  });
});

describe("generateSlots — материализация в БД (spec 7.8)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function makeInterviewer() {
    const user = await createTestUser({
      email: "interviewer@test.local",
      role: "owner",
      isInterviewer: true,
      timezone: MSK,
    });
    await testDb.interviewerProfile.create({
      data: { userId: user.id, roomUrl: "https://telemost.yandex.ru/room", active: true },
    });
    return user;
  }

  it("создаёт open-слоты по правилу; повторный вызов идемпотентен", async () => {
    const interviewer = await makeInterviewer();
    await testDb.availabilityRule.create({
      data: { interviewerId: interviewer.id, weekday: 4, startTime: "18:00", endTime: "21:00" },
    });

    const first = await generateSlots(testDb, { interviewerId: interviewer.id, now: NOW });
    expect(first.created).toBeGreaterThan(0);
    const count1 = await testDb.slot.count({ where: { interviewerId: interviewer.id } });

    const second = await generateSlots(testDb, { interviewerId: interviewer.id, now: NOW });
    expect(second.created).toBe(0);
    expect(second.removed).toBe(0);
    const count2 = await testDb.slot.count({ where: { interviewerId: interviewer.id } });
    expect(count2).toBe(count1);

    // Все слоты — в будущем и open.
    const slots = await testDb.slot.findMany({ where: { interviewerId: interviewer.id } });
    expect(slots.every((s) => s.startsAt > NOW && s.status === "open")).toBe(true);
  });

  it("day_off-исключение убирает open-слоты этой даты при пересборке", async () => {
    const interviewer = await makeInterviewer();
    await testDb.availabilityRule.create({
      data: { interviewerId: interviewer.id, weekday: 4, startTime: "18:00", endTime: "21:00" },
    });
    await generateSlots(testDb, { interviewerId: interviewer.id, now: NOW });
    const thursdayStart = zonedDateTimeToUtc("2026-07-09", "18:00", MSK);
    expect(await testDb.slot.count({ where: { startsAt: thursdayStart } })).toBe(1);

    await testDb.availabilityException.create({
      data: {
        interviewerId: interviewer.id,
        date: new Date("2026-07-09T00:00:00.000Z"),
        kind: "day_off",
      },
    });
    const res = await generateSlots(testDb, { interviewerId: interviewer.id, now: NOW });
    expect(res.removed).toBeGreaterThan(0);
    expect(await testDb.slot.count({ where: { startsAt: thursdayStart } })).toBe(0);
  });

  it("пересборка не трогает booked-слот вне нового окна", async () => {
    const interviewer = await makeInterviewer();
    const rule = await testDb.availabilityRule.create({
      data: { interviewerId: interviewer.id, weekday: 4, startTime: "18:00", endTime: "21:00" },
    });
    await generateSlots(testDb, { interviewerId: interviewer.id, now: NOW });

    const thursdayStart = zonedDateTimeToUtc("2026-07-09", "18:00", MSK);
    const slot = await testDb.slot.findFirstOrThrow({ where: { startsAt: thursdayStart } });
    await testDb.slot.update({ where: { id: slot.id }, data: { status: "booked" } });

    // Снимаем правило целиком и пересобираем — booked-слот сохраняется.
    await testDb.availabilityRule.delete({ where: { id: rule.id } });
    await generateSlots(testDb, { interviewerId: interviewer.id, now: NOW });

    const kept = await testDb.slot.findUnique({ where: { id: slot.id } });
    expect(kept?.status).toBe("booked");
    // Свободные слоты правила при этом удалены.
    expect(
      await testDb.slot.count({ where: { interviewerId: interviewer.id, status: "open" } }),
    ).toBe(0);
  });

  it("не материализует слоты не-интервьюеру", async () => {
    const user = await createTestUser({ email: "plain@test.local", timezone: MSK });
    await testDb.availabilityRule.create({
      data: { interviewerId: user.id, weekday: 4, startTime: "18:00", endTime: "21:00" },
    });
    const res = await generateSlots(testDb, { interviewerId: user.id, now: NOW });
    expect(res).toEqual({ created: 0, removed: 0 });
    expect(await testDb.slot.count({ where: { interviewerId: user.id } })).toBe(0);
  });
});

describe("TZ-отображение слотов — чипы в TZ ученика (spec 7.8/8.3)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("слот 18:00 МСК (15:00 UTC) показывается ученику в Екатеринбурге как 20:00", async () => {
    const interviewer = await createInterviewer("i@test.local", MSK);
    const student = await createTestUser({
      email: "s@test.local",
      timezone: "Asia/Yekaterinburg", // UTC+5
      accessUntil: new Date("2027-01-01T00:00:00.000Z"),
    });
    const start = zonedDateTimeToUtc("2026-07-09", "18:00", MSK); // 15:00 UTC
    await createSlot(interviewer.id, start);

    const available = await getAvailableSlots(testDb, {
      studentId: student.id,
      type: "theory",
      interviewerId: interviewer.id,
      now: NOW,
    });
    expect(available.timezone).toBe("Asia/Yekaterinburg");
    const chips = available.days.flatMap((d) => d.chips);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.timeLabel).toBe("20:00"); // 15:00 UTC + 5
  });
});
