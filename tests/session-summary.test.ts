import { describe, expect, it } from "vitest";
import {
  DECK_RHYTHM_MAX_SEGMENTS,
  gradeSharePercent,
  rhythmSegments,
  sessionPortionNote,
  summarizeGrades,
  type SessionGrade,
} from "@/lib/utils/session-summary";

// Арифметика сессии карточек (заход C.8 «Сессия повторений v2»). Всё чистое:
// ритм, итоги порции и номер порции считаются здесь, а дека и финальные экраны
// только рисуют — второго счёта в проекте нет.

describe("итоги порции", () => {
  it("считает оценки по видам и общее число отвеченного", () => {
    const grades: SessionGrade[] = ["good", "again", "good", "hard", "good"];
    expect(summarizeGrades(grades)).toEqual({ good: 3, hard: 1, again: 1, answered: 5 });
  });

  it("пустая порция — нули, а не деление на ноль", () => {
    expect(summarizeGrades([])).toEqual({ good: 0, hard: 0, again: 0, answered: 0 });
    expect(gradeSharePercent(0, 0)).toBe(0);
  });

  it("доля оценки — проценты от ОТВЕЧЕННОГО, а не от размера порции", () => {
    // Ученик вышел после 4 карточек из 15: «Знаю 3» — это 75%, а не 20%.
    const summary = summarizeGrades(["good", "good", "good", "again"]);
    expect(gradeSharePercent(summary.good, summary.answered)).toBe(75);
    expect(gradeSharePercent(summary.again, summary.answered)).toBe(25);
  });
});

describe("ритм по карточкам", () => {
  it("отвеченные — своей оценкой, текущая — current, остальные — todo", () => {
    const segments = rhythmSegments(["good", "again"], 5, 2, true);
    expect(segments).toEqual([
      { kind: "graded", grade: "good" },
      { kind: "graded", grade: "again" },
      { kind: "current" },
      { kind: "todo" },
      { kind: "todo" },
    ]);
  });

  it("на финальных экранах текущей карточки нет — подсвечивать нечего", () => {
    const segments = rhythmSegments(["good", "hard"], 3, 2, false);
    expect(segments.map((segment) => segment.kind)).toEqual(["graded", "graded", "todo"]);
  });

  it("пропущенная без записи карточка не крадёт цвет у следующей", () => {
    // Ветка not_due: карточка сменилась, оценка не записана. Позиция остаётся
    // незакрашенной, а «текущая» стоит там, где ученик сейчас.
    const segments = rhythmSegments(["good"], 4, 2, true);
    expect(segments.map((segment) => segment.kind)).toEqual(["graded", "todo", "current", "todo"]);
  });

  it("порог сплошной полосы — 20 сегментов", () => {
    expect(DECK_RHYTHM_MAX_SEGMENTS).toBe(20);
  });
});

describe("номер порции дневной очереди", () => {
  it("одна порция в очереди — номер не пишется", () => {
    expect(sessionPortionNote({ answeredToday: 0, queueTotal: 9, portionSize: 15 })).toBe(
      "дневная очередь",
    );
  });

  it("две порции: первая", () => {
    expect(sessionPortionNote({ answeredToday: 0, queueTotal: 24, portionSize: 15 })).toBe(
      "Порция 1 из 2 · дневная очередь",
    );
  });

  it("вторая порция после закрытой первой — номер сдвигается, а не сбрасывается", () => {
    // После «Продолжить» очередь пересобирается: осталось 9, но 15 уже отвечено.
    expect(sessionPortionNote({ answeredToday: 15, queueTotal: 9, portionSize: 15 })).toBe(
      "Порция 2 из 2 · дневная очередь",
    );
  });

  it("недобранная порция не считается закрытой", () => {
    // Ученик ответил 7 из 15 и вышел; вернулся — он всё ещё в первой порции.
    expect(sessionPortionNote({ answeredToday: 7, queueTotal: 20, portionSize: 15 })).toBe(
      "Порция 1 из 2 · дневная очередь",
    );
  });

  it("пустая очередь и нулевой размер порции не роняют подпись", () => {
    expect(sessionPortionNote({ answeredToday: 0, queueTotal: 0, portionSize: 15 })).toBe(
      "дневная очередь",
    );
    expect(sessionPortionNote({ answeredToday: 3, queueTotal: 10, portionSize: 0 })).toBe(
      "дневная очередь",
    );
  });
});
