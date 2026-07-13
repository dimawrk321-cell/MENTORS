import { describe, expect, it } from "vitest";
import {
  applyGrade,
  estimateQueueMinutes,
  SRS_LEARNED_INTERVAL_DAYS,
  SRS_LEARNED_STEP,
  SRS_STEPS,
} from "@/lib/services/srs";
import { addDays, dateOnlyUtc } from "@/lib/utils/dates";

// Обязательный набор этапа 4 (spec 7.6/19): все переходы again/hard/good на
// каждом step, включая cap на 5 и контрольные 90 дней. Планировщик — чистая
// функция: today = UTC-полночь календарного «сегодня» пользователя.

const TODAY = dateOnlyUtc("2026-07-08");

describe("applyGrade: again (spec 7.6)", () => {
  for (let step = 0; step <= SRS_LEARNED_STEP; step += 1) {
    it(`step ${step} → step 0, next = завтра, lapses+1`, () => {
      const result = applyGrade({ step, lapses: 2 }, "again", TODAY);
      expect(result).toEqual({
        step: 0,
        nextReviewAt: addDays(TODAY, 1),
        lapses: 3,
      });
    });
  }
});

describe("applyGrade: hard (spec 7.6)", () => {
  for (let step = 0; step < SRS_LEARNED_STEP; step += 1) {
    it(`step ${step} → step не меняется, next = today + ${SRS_STEPS[step]}`, () => {
      const result = applyGrade({ step, lapses: 1 }, "hard", TODAY);
      expect(result).toEqual({
        step,
        nextReviewAt: addDays(TODAY, SRS_STEPS[step]!),
        lapses: 1,
      });
    });
  }

  it("step 5 («выучен») → остаётся 5, next = +90 дней", () => {
    const result = applyGrade({ step: 5, lapses: 0 }, "hard", TODAY);
    expect(result).toEqual({
      step: 5,
      nextReviewAt: addDays(TODAY, SRS_LEARNED_INTERVAL_DAYS),
      lapses: 0,
    });
  });
});

describe("applyGrade: good (spec 7.6)", () => {
  // step 0..3 → new_step 1..4, интервал STEPS[new_step].
  for (let step = 0; step <= 3; step += 1) {
    it(`step ${step} → step ${step + 1}, next = today + ${SRS_STEPS[step + 1]}`, () => {
      const result = applyGrade({ step, lapses: 4 }, "good", TODAY);
      expect(result).toEqual({
        step: step + 1,
        nextReviewAt: addDays(TODAY, SRS_STEPS[step + 1]!),
        lapses: 4,
      });
    });
  }

  it("step 4 → step 5 («выучен»), next = +90 дней", () => {
    const result = applyGrade({ step: 4, lapses: 0 }, "good", TODAY);
    expect(result).toEqual({
      step: 5,
      nextReviewAt: addDays(TODAY, SRS_LEARNED_INTERVAL_DAYS),
      lapses: 0,
    });
  });

  it("step 5 → cap на 5, снова +90 дней", () => {
    const result = applyGrade({ step: 5, lapses: 7 }, "good", TODAY);
    expect(result).toEqual({
      step: 5,
      nextReviewAt: addDays(TODAY, SRS_LEARNED_INTERVAL_DAYS),
      lapses: 7,
    });
  });
});

describe("оценка времени (spec 7.6: count × 25 сек, округление вверх)", () => {
  it("считает и округляет вверх до минут", () => {
    expect(estimateQueueMinutes(0)).toBe(0);
    expect(estimateQueueMinutes(1)).toBe(1); // 25 сек → 1 мин
    expect(estimateQueueMinutes(2)).toBe(1); // 50 сек → 1 мин
    expect(estimateQueueMinutes(3)).toBe(2); // 75 сек → 2 мин
    expect(estimateQueueMinutes(14)).toBe(6); // 350 сек → 6 мин
    expect(estimateQueueMinutes(15)).toBe(7); // 375 сек → 7 мин
    expect(estimateQueueMinutes(24)).toBe(10); // ровно 600 сек → 10 мин
  });
});
