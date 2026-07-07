import { describe, expect, it } from "vitest";
import { checkAnswer, normalizeShortText } from "@/lib/utils/answers";

// Mandatory suite (stage 3): short_text-нормализация (spec 7.4) и автопроверка
// закрытых типов (spec 7.5) — pure logic.

describe("normalizeShortText (spec 7.4: trim → lower → ё=е → пробелы)", () => {
  it("trims and lowercases", () => {
    expect(normalizeShortText("  Сигмоида  ")).toBe("сигмоида");
  });

  it("maps ё to е", () => {
    expect(normalizeShortText("свёртка")).toBe("свертка");
    expect(normalizeShortText("СВЁРТКА")).toBe("свертка");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeShortText("градиентный   \t спуск")).toBe("градиентный спуск");
  });

  it("full chain", () => {
    expect(normalizeShortText("  Логистическая   Функция ")).toBe("логистическая функция");
  });
});

const OPTIONS = [
  { id: "a", text: "А", correct: true },
  { id: "b", text: "Б", correct: false },
  { id: "c", text: "В", correct: true },
];

describe("checkAnswer", () => {
  it("single: только правильный вариант", () => {
    const q = { type: "single" as const, options: [OPTIONS[0], OPTIONS[1]] };
    expect(checkAnswer(q, "a")).toBe(true);
    expect(checkAnswer(q, "b")).toBe(false);
    expect(checkAnswer(q, "missing")).toBe(false);
    expect(checkAnswer(q, ["a"])).toBe(false); // неверная форма ответа
  });

  it("tf работает как single", () => {
    const q = {
      type: "tf" as const,
      options: [
        { id: "true", text: "Верно", correct: true },
        { id: "false", text: "Неверно", correct: false },
      ],
    };
    expect(checkAnswer(q, "true")).toBe(true);
    expect(checkAnswer(q, "false")).toBe(false);
  });

  it("multi: точное совпадение множества правильных", () => {
    const q = { type: "multi" as const, options: OPTIONS };
    expect(checkAnswer(q, ["a", "c"])).toBe(true);
    expect(checkAnswer(q, ["c", "a"])).toBe(true); // порядок не важен
    expect(checkAnswer(q, ["a"])).toBe(false); // не все
    expect(checkAnswer(q, ["a", "b", "c"])).toBe(false); // лишний
    expect(checkAnswer(q, [])).toBe(false);
    expect(checkAnswer(q, "a")).toBe(false); // неверная форма
  });

  it("short_text: сравнение через нормализацию", () => {
    const q = {
      type: "short_text" as const,
      acceptedAnswers: ["Сигмоида", "sigmoid"],
    };
    expect(checkAnswer(q, "сигмоида")).toBe(true);
    expect(checkAnswer(q, "  СИГМОИДА  ")).toBe(true);
    expect(checkAnswer(q, "Sigmoid")).toBe(true);
    expect(checkAnswer(q, "софтмакс")).toBe(false);
    expect(checkAnswer(q, "")).toBe(false);
  });

  it("short_text: нормализация применяется и к эталонам (ё, пробелы)", () => {
    const q = { type: "short_text" as const, acceptedAnswers: ["СВЁРТКА  нейронная"] };
    expect(checkAnswer(q, "свертка нейронная")).toBe(true);
  });

  it("open никогда не автопроверяется", () => {
    expect(checkAnswer({ type: "open" as const }, "что угодно")).toBe(false);
  });
});
