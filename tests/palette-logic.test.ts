import { describe, it, expect } from "vitest";
import type { RecentItemType } from "@prisma/client";
import {
  filterActionsByQuery,
  groupLabel,
  isOpenPaletteHotkey,
  normalizeGroupType,
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

// Block 0.1 regression: «Недавнее» rows carry the DB's SINGULAR RecentItemType
// ("guide"), but the palette indexed GROUP_ICON with the PLURAL GroupType. The
// lookup returned undefined → <undefined/> → React #130 → the fullscreen error
// boundary the owner hit. normalizeGroupType bridges the two; iconFor then falls
// back to a safe icon, so no icon lookup can render undefined again.
describe("palette — normalizeGroupType icon crash (spec 13.1/0.1)", () => {
  it("maps the recent API's SINGULAR types onto the plural GROUP_ICON keys", () => {
    const recentTypes: RecentItemType[] = ["lesson", "question", "guide", "recording"];
    expect(recentTypes.map((t) => normalizeGroupType(t))).toEqual([
      "lessons",
      "questions",
      "guides",
      "recordings",
    ]);
    // Every recent type resolves to a non-null (⇒ present-in-GROUP_ICON) key.
    for (const t of recentTypes) expect(normalizeGroupType(t)).not.toBeNull();
  });

  it("passes plural search-group types through unchanged", () => {
    for (const t of ["lessons", "questions", "guides", "recordings"] as const) {
      expect(normalizeGroupType(t)).toBe(t);
    }
  });

  it("returns null for an unknown type so the caller uses the fallback icon", () => {
    expect(normalizeGroupType("bogus")).toBeNull();
    expect(normalizeGroupType("")).toBeNull();
    expect(normalizeGroupType("library")).toBe("recordings"); // legacy alias
  });
});
