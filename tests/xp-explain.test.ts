import { describe, expect, it } from "vitest";
import {
  dayCountingLabels,
  goalProgress,
  missingDayEventLabels,
  topUpHints,
  xpRows,
} from "@/lib/utils/xp-explain";
import { DEFAULT_XP_MAP, XP_MAP_KEYS } from "@/lib/services/xp";
import { STREAK_QUALIFYING_EVENTS } from "@/lib/services/streak";

// Заход B.2, блок 1. Объяснение обязано строиться из тех же источников, что и
// механика: значения — из карты XP, список «что засчитывает день» — из
// STREAK_QUALIFYING_EVENTS. Иначе оно однажды разойдётся с правдой и будет
// врать увереннее, чем молчание.

describe("что засчитывает день", () => {
  it("у каждого события механики есть подпись", () => {
    expect(missingDayEventLabels()).toEqual([]);
  });

  it("покрыты все события множества, попытки теста слиты в одну строку", () => {
    const labels = dayCountingLabels();
    expect(labels).toContain("завершил урок");
    expect(labels).toContain("закрыл очередь повторений");
    // passed и failed — две записи механики, но для ученика это одна мысль.
    expect(STREAK_QUALIFYING_EVENTS.has("test.passed")).toBe(true);
    expect(STREAK_QUALIFYING_EVENTS.has("test.failed")).toBe(true);
    expect(labels.filter((l) => l.includes("попытку модульного теста"))).toHaveLength(1);
    expect(labels).not.toContain("сдал модульный тест");
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("таблица начислений", () => {
  it("строится по ключам карты XP и берёт значения из неё, а не из вёрстки", () => {
    const custom = { ...DEFAULT_XP_MAP, "lesson.completed": 42 };
    const rows = xpRows(custom);
    expect(rows.map((r) => r.key)).toEqual([...XP_MAP_KEYS]);
    expect(rows.find((r) => r.key === "lesson.completed")!.amount).toBe(42);
    // Подпись и уточнение разовости есть у каждой строки.
    expect(rows.every((r) => r.label.length > 0 && r.note.length > 0)).toBe(true);
  });

  it("«чем добрать» предлагает только то, что ученик может сделать сейчас", () => {
    const hints = topUpHints(DEFAULT_XP_MAP);
    // Порядок — как в карте XP (XP_MAP_KEYS), состав — три «сделай сейчас».
    expect(hints.map((h) => h.key)).toEqual([
      "lesson.completed",
      "quiz.correct_first",
      "queue.completed",
    ]);
    // Вехи серии и «с первой попытки» сюда не попадают: их нельзя сделать по
    // желанию прямо сейчас.
    expect(hints.some((h) => h.key.startsWith("streak."))).toBe(false);
    expect(hints.some((h) => h.key === "test.passed_first_try")).toBe(false);
  });

  it("нулевое значение из настроек в подсказки не попадает", () => {
    const zeroed = { ...DEFAULT_XP_MAP, "queue.completed": 0, "lesson.completed": 0 };
    expect(topUpHints(zeroed).map((h) => h.key)).toEqual(["quiz.correct_first"]);
  });
});

describe("прогресс дневной цели", () => {
  it("считает остаток и закрытие", () => {
    expect(goalProgress(0, 60)).toMatchObject({ remaining: 60, closed: false });
    expect(goalProgress(25, 60)).toMatchObject({ remaining: 35, closed: false });
    expect(goalProgress(60, 60)).toMatchObject({ remaining: 0, closed: true });
    // Перевыполнение не даёт отрицательного остатка.
    expect(goalProgress(85, 60)).toMatchObject({ remaining: 0, closed: true });
  });

  it("нулевая цель не считается закрытой и не делит на ноль", () => {
    expect(goalProgress(0, 0)).toMatchObject({ remaining: 0, closed: false });
  });
});
