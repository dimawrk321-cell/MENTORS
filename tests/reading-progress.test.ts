import { describe, expect, it } from "vitest";
import {
  activeHeadingId,
  buildToc,
  readingFraction,
  readingPercent,
  sectionDepth,
  SCROLL_SPY_OFFSET,
  type ReadingHeading,
} from "@/lib/utils/reading";

// «Читалка v2»: полоса прогресса чтения, scroll-spy оглавления и уровень
// вложенности его пунктов держатся на этих чистых функциях — общий хук
// (lib/hooks/use-reading-progress.ts) только слушает скролл и подставляет
// измерения. В репозитории нет jsdom (vitest environment: node), поэтому
// проверяемая часть намеренно вынесена из DOM.

const h = (id: string, depth: number, text = id): ReadingHeading => ({ id, text, depth });

describe("readingFraction — полоса прогресса чтения", () => {
  it("даёт долю прокрутки документа", () => {
    // 3000 документа − 1000 вьюпорт = 2000 хода; 500 → 25%.
    expect(readingFraction(500, 3000, 1000)).toBeCloseTo(0.25);
    expect(readingFraction(2000, 3000, 1000)).toBe(1);
    expect(readingFraction(0, 3000, 1000)).toBe(0);
  });

  it("зажимает выход за границы (bounce-скролл, overscroll)", () => {
    expect(readingFraction(-120, 3000, 1000)).toBe(0);
    expect(readingFraction(9999, 3000, 1000)).toBe(1);
  });

  it("документ короче вьюпорта считается прочитанным целиком", () => {
    // Иначе короткий гайд вечно показывал бы «прочитано 0%» при пустой полосе.
    expect(readingFraction(0, 600, 900)).toBe(1);
    expect(readingFraction(0, 900, 900)).toBe(1);
  });

  it("не отдаёт NaN на невалидных измерениях", () => {
    expect(readingFraction(Number.NaN, 3000, 1000)).toBe(0);
    expect(readingFraction(0, Number.NaN, 1000)).toBe(1);
  });
});

describe("readingPercent — «прочитано N%»", () => {
  it("округляет и зажимает", () => {
    expect(readingPercent(0)).toBe(0);
    expect(readingPercent(0.256)).toBe(26);
    expect(readingPercent(1)).toBe(100);
    expect(readingPercent(1.5)).toBe(100);
    expect(readingPercent(-1)).toBe(0);
    expect(readingPercent(Number.NaN)).toBe(0);
  });
});

describe("sectionDepth — какой уровень заголовков считается верхним", () => {
  it("H2, когда они есть", () => {
    expect(sectionDepth([h("a", 2), h("b", 3), h("c", 2)])).toBe(2);
  });

  it("падает на H3, когда H2 в документе нет", () => {
    // 63 из 85 уроков и 20 из 22 гайдов базы структурированы H3 — жёсткая
    // привязка к H2 сплющила бы их оглавление в один уровень.
    expect(sectionDepth([h("a", 3), h("b", 3)])).toBe(3);
  });

  it("документ без заголовков — уровня нет", () => {
    expect(sectionDepth([])).toBeNull();
  });
});

describe("buildToc — уровни пунктов оглавления", () => {
  it("порядковых номеров у пунктов нет — только текст и уровень", () => {
    // Решение владельца: импортированные заголовки почти все пронумерованы
    // руками прямо в тексте («1. Базовый минимум…»), автонумерация давала
    // вторую поверх первой.
    const toc = buildToc([h("intro", 2, "1. Базовый минимум")]);
    expect(Object.keys(toc[0]!).sort()).toEqual(["depth", "id", "isSection", "text"]);
    expect(toc[0]!.text).toBe("1. Базовый минимум");
  });

  it("верхний уровень отмечен разделом, вложенный — нет", () => {
    const toc = buildToc([h("intro", 2), h("intro-sub", 3), h("practice", 2)]);
    expect(toc.map((e) => e.isSection)).toEqual([true, false, true]);
  });

  it("в документе без H2 разделами становятся H3", () => {
    const toc = buildToc([h("a", 3), h("b", 3), h("c", 3)]);
    expect(toc.map((e) => e.isSection)).toEqual([true, true, true]);
  });

  it("документ без заголовков даёт пустое оглавление", () => {
    expect(buildToc([])).toEqual([]);
  });

  it("сохраняет исходный текст и порядок заголовков", () => {
    const toc = buildToc([h("a", 2, "Идея метода"), h("b", 2, "Что тюнить")]);
    expect(toc.map((e) => e.text)).toEqual(["Идея метода", "Что тюнить"]);
  });
});

describe("activeHeadingId — scroll-spy", () => {
  const offsets = [
    { id: "one", top: 400 },
    { id: "two", top: 1200 },
    { id: "three", top: 2400 },
  ];

  it("до первого заголовка активен первый раздел", () => {
    // Лид-абзац: пустая подсветка читается как сломанное оглавление.
    expect(activeHeadingId(offsets, 0)).toBe("one");
  });

  it("активен последний заголовок, пересёкший читальную линию", () => {
    expect(activeHeadingId(offsets, 400)).toBe("one");
    expect(activeHeadingId(offsets, 1200 - SCROLL_SPY_OFFSET)).toBe("two");
    expect(activeHeadingId(offsets, 1300)).toBe("two");
    expect(activeHeadingId(offsets, 2400)).toBe("three");
  });

  it("на самом низу активен последний раздел, даже если его верх линии не достиг", () => {
    // Короткий финальный раздел иначе никогда не подсвечивался бы.
    expect(activeHeadingId(offsets, 100, SCROLL_SPY_OFFSET, true)).toBe("three");
  });

  it("без заголовков активного нет", () => {
    expect(activeHeadingId([], 500)).toBeNull();
    expect(activeHeadingId([], 500, SCROLL_SPY_OFFSET, true)).toBeNull();
  });

  it("уважает собственный отступ читальной линии", () => {
    expect(activeHeadingId(offsets, 1150, 0)).toBe("one");
    expect(activeHeadingId(offsets, 1150, 100)).toBe("two");
  });
});
