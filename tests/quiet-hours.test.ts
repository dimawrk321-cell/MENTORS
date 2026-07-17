import { describe, expect, it } from "vitest";
import {
  hhmmToMinutes,
  isWithinQuietHours,
  localMinutesOfDay,
  nextLocalTimeUtc,
} from "@/lib/utils/dates";

// Тихие часы (spec 7.12): границы окна, переход через полночь, TZ-зависимость,
// вычисление момента «конца тихих часов» для отложенного email. Чистая логика,
// без БД. MSK = UTC+3 без DST — инстанты строим ISO-строкой с оффсетом.

const MSK = "Europe/Moscow";
/** UTC instant of a Moscow wall-clock time. */
const msk = (iso: string) => new Date(`${iso}:00+03:00`);

describe("hhmmToMinutes / localMinutesOfDay", () => {
  it("парсит HH:MM в минуты", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("09:30")).toBe(570);
    expect(hhmmToMinutes("23:59")).toBe(1439);
  });

  it("минуты локального дня в TZ", () => {
    // 09:00 MSK
    expect(localMinutesOfDay(msk("2026-07-15T09:00"), MSK)).toBe(540);
    // тот же инстант в UTC → 06:00
    expect(localMinutesOfDay(msk("2026-07-15T09:00"), "UTC")).toBe(360);
  });
});

describe("isWithinQuietHours: окно через полночь 22:00–08:00", () => {
  const within = (iso: string) => isWithinQuietHours(msk(iso), MSK, "22:00", "08:00");

  it("ночь и раннее утро — внутри", () => {
    expect(within("2026-07-15T23:00")).toBe(true);
    expect(within("2026-07-15T03:00")).toBe(true);
    expect(within("2026-07-15T07:59")).toBe(true);
  });

  it("границы: 22:00 включительно, 08:00 исключительно", () => {
    expect(within("2026-07-15T22:00")).toBe(true);
    expect(within("2026-07-15T08:00")).toBe(false);
  });

  it("день — снаружи", () => {
    expect(within("2026-07-15T12:00")).toBe(false);
    expect(within("2026-07-15T21:59")).toBe(false);
  });
});

describe("isWithinQuietHours: окно без перехода и пустое", () => {
  it("13:00–14:00 — обычный интервал", () => {
    expect(isWithinQuietHours(msk("2026-07-15T13:30"), MSK, "13:00", "14:00")).toBe(true);
    expect(isWithinQuietHours(msk("2026-07-15T14:00"), MSK, "13:00", "14:00")).toBe(false);
    expect(isWithinQuietHours(msk("2026-07-15T12:59"), MSK, "13:00", "14:00")).toBe(false);
  });

  it("равные границы → окна нет (никогда не тихо)", () => {
    expect(isWithinQuietHours(msk("2026-07-15T22:00"), MSK, "22:00", "22:00")).toBe(false);
    expect(isWithinQuietHours(msk("2026-07-15T03:00"), MSK, "00:00", "00:00")).toBe(false);
  });
});

describe("isWithinQuietHours: зависит от TZ пользователя", () => {
  it("один инстант — в MSK день, в Нью-Йорке ночь", () => {
    // 06:00 UTC = 09:00 MSK (не тихо) = 02:00 America/New_York летом (тихо).
    const instant = new Date("2026-07-15T06:00:00Z");
    expect(isWithinQuietHours(instant, MSK, "22:00", "08:00")).toBe(false);
    expect(isWithinQuietHours(instant, "America/New_York", "22:00", "08:00")).toBe(true);
  });
});

describe("nextLocalTimeUtc: момент конца тихих часов", () => {
  it("вечер → конец (08:00) завтра", () => {
    const now = msk("2026-07-15T23:00");
    // 08:00 MSK 16-го = 05:00 UTC 16-го
    expect(nextLocalTimeUtc(now, MSK, "08:00").toISOString()).toBe("2026-07-16T05:00:00.000Z");
  });

  it("раннее утро (до 08:00) → конец сегодня", () => {
    const now = msk("2026-07-15T03:00");
    expect(nextLocalTimeUtc(now, MSK, "08:00").toISOString()).toBe("2026-07-15T05:00:00.000Z");
  });

  it("ровно на целевом времени → завтра (строгое «после»)", () => {
    const now = msk("2026-07-15T08:00");
    expect(nextLocalTimeUtc(now, MSK, "08:00").toISOString()).toBe("2026-07-16T05:00:00.000Z");
  });
});
