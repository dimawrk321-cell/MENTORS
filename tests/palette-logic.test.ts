import { describe, it, expect } from "vitest";
import {
  filterActionsByQuery,
  groupLabel,
  isOpenPaletteHotkey,
  wrapIndex,
} from "@/lib/palette-logic";

// Stage 8 CommandPalette pure logic (spec 7.11): hotkey mapping, list navigation
// wrap-around, «Действия» substring filter, and group labelling. Browser-free.

describe("palette — hotkey mapping (spec 7.11)", () => {
  it("opens on Cmd+K and Ctrl+K, case-insensitive", () => {
    expect(isOpenPaletteHotkey({ metaKey: true, ctrlKey: false, key: "k" })).toBe(true);
    expect(isOpenPaletteHotkey({ metaKey: false, ctrlKey: true, key: "K" })).toBe(true);
  });
  it("ignores K without a modifier and other modified keys", () => {
    expect(isOpenPaletteHotkey({ metaKey: false, ctrlKey: false, key: "k" })).toBe(false);
    expect(isOpenPaletteHotkey({ metaKey: true, ctrlKey: false, key: "j" })).toBe(false);
  });
});

describe("palette — navigation wrap-around (spec 7.11)", () => {
  it("wraps forward and backward", () => {
    expect(wrapIndex(0, 3, 1)).toBe(1);
    expect(wrapIndex(2, 3, 1)).toBe(0);
    expect(wrapIndex(0, 3, -1)).toBe(2);
  });
  it("is safe for an empty list", () => {
    expect(wrapIndex(0, 0, 1)).toBe(0);
    expect(wrapIndex(0, 0, -1)).toBe(0);
  });
});

describe("palette — action filter & group labels (spec 7.11)", () => {
  const actions = [
    { title: "Продолжить урок" },
    { title: "Начать повторения" },
    { title: "Забронировать мок" },
    { title: "Мои закладки" },
  ];

  it("filters actions by case-insensitive substring", () => {
    expect(filterActionsByQuery(actions, "мок").map((a) => a.title)).toEqual(["Забронировать мок"]);
    expect(filterActionsByQuery(actions, "ЗАКЛ").map((a) => a.title)).toEqual(["Мои закладки"]);
  });
  it("returns all actions for an empty query", () => {
    expect(filterActionsByQuery(actions, "  ").length).toBe(4);
  });

  it("labels groups, annotating the fuzzy fallback", () => {
    expect(groupLabel("lessons", false)).toBe("Уроки");
    expect(groupLabel("questions", true)).toBe("Вопросы · Возможно, вы искали");
  });
});
