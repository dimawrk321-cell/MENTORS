import { describe, expect, it } from "vitest";
import { accuracyColorVar, heatmapActiveDays, lessonTotals } from "@/lib/utils/profile-overview";

describe("показатели обзора профиля", () => {
  it("суммирует обязательные уроки тем же способом, что карточки курсов", () => {
    expect(
      lessonTotals([
        { lessonsCompleted: 3, lessonsTotal: 4 },
        { lessonsCompleted: 1, lessonsTotal: 6 },
      ]),
    ).toEqual({ completed: 4, total: 10, pct: 40 });
    expect(lessonTotals([])).toEqual({ completed: 0, total: 0, pct: 0 });
  });

  it("не считает будущие ячейки активными", () => {
    expect(
      heatmapActiveDays({
        columns: [
          [
            {
              date: "2026-08-24",
              lessons: 1,
              cards: 0,
              tests: 0,
              total: 1,
              level: 1,
              future: false,
            },
            {
              date: "2026-08-25",
              lessons: 0,
              cards: 0,
              tests: 0,
              total: 0,
              level: 0,
              future: false,
            },
            {
              date: "2026-08-27",
              lessons: 1,
              cards: 0,
              tests: 0,
              total: 1,
              level: 1,
              future: true,
            },
          ],
        ],
      }),
    ).toBe(1);
  });

  it("использует только токены дизайн-системы для точности тем", () => {
    expect(accuracyColorVar(90)).toBe("var(--success)");
    expect(accuracyColorVar(60)).toBe("var(--cat-5)");
    expect(accuracyColorVar(40)).toBe("var(--warning)");
    expect(accuracyColorVar(20)).toBe("var(--danger)");
  });
});
