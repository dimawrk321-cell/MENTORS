import { describe, expect, it } from "vitest";
import { bookingRulesLine, CANCEL_FREE_HOURS, STRIKE_LOCK_DAYS } from "@/lib/constants";

// Заход B.2 (правка владельца). Строка правил на шаге подтверждения брони —
// единственное место, где ученику называются числа; урок «Правила игры» их
// намеренно не повторяет и отсылает сюда. Значит строка обязана следовать
// настройкам платформы, а не константам: `ops_cancel_free_hours` и
// `ops_strike_lock_days` редактируются в /admin/settings, и захардкоженный текст
// начал бы врать в тот же момент, когда владелец их поменяет.

describe("строка правил брони", () => {
  it("на дефолтах читается как раньше", () => {
    expect(
      bookingRulesLine({ cancelFreeHours: CANCEL_FREE_HOURS, lockDays: STRIKE_LOCK_DAYS }),
    ).toBe(
      "Отмена бесплатна за 24 часа. Поздняя отмена, поздний перенос или неявка — страйк; 2 страйка подряд — пауза брони на 14 дней",
    );
  });

  it("следует настройкам, а не константам", () => {
    const line = bookingRulesLine({ cancelFreeHours: 48, lockDays: 7 });
    expect(line).toContain("48 часов");
    expect(line).toContain("7 дней");
    expect(line).not.toContain("24");
    expect(line).not.toContain("14");
  });

  it("склоняет часы и дни", () => {
    expect(bookingRulesLine({ cancelFreeHours: 1, lockDays: 1 })).toContain("за 1 час.");
    expect(bookingRulesLine({ cancelFreeHours: 1, lockDays: 1 })).toContain("на 1 день");
    expect(bookingRulesLine({ cancelFreeHours: 3, lockDays: 3 })).toContain("за 3 часа.");
    expect(bookingRulesLine({ cancelFreeHours: 3, lockDays: 3 })).toContain("на 3 дня");
  });

  it("называет все три причины страйка — перенос тоже выписывает late_cancel", () => {
    const line = bookingRulesLine({ cancelFreeHours: 24, lockDays: 14 });
    expect(line).toContain("Поздняя отмена");
    expect(line).toContain("поздний перенос");
    expect(line).toContain("неявка");
  });
});
