import { describe, it, expect } from "vitest";
import {
  DEFAULT_LEVEL_TITLES,
  titleForLevel,
  parseLevelTitles,
  serializeLevelTitles,
  parseStoredLevelTitles,
  freezeCapForMilestone,
} from "@/lib/services/level-titles";

// D7 (spec 13.1): editable level-title ladder.

describe("level titles (spec 13.1/D7)", () => {
  it("titleForLevel picks the highest entry with minLevel ≤ level", () => {
    expect(titleForLevel(1)).toBe("Импортёр pandas");
    expect(titleForLevel(4)).toBe("Джун на испытательном"); // minLevel 3 applies to 4
    expect(titleForLevel(5)).toBe("Профессиональный оверфиттер");
    expect(titleForLevel(25)).toBe(DEFAULT_LEVEL_TITLES.at(-1)!.title); // 20+ → last
    expect(titleForLevel(0)).toBe(""); // below the ladder
  });

  it("parse/serialize round-trips and sorts by level", () => {
    const parsed = parseLevelTitles("5 Оверфиттер\n1 Старт\nмусор без уровня\n");
    expect(parsed).toEqual([
      { minLevel: 1, title: "Старт" },
      { minLevel: 5, title: "Оверфиттер" },
    ]);
    expect(serializeLevelTitles(parsed)).toBe("1 Старт\n5 Оверфиттер");
  });

  it("parseStoredLevelTitles validates and falls back to null on garbage", () => {
    expect(parseStoredLevelTitles("nope")).toBeNull();
    expect(parseStoredLevelTitles([{ minLevel: 0, title: "x" }])).toBeNull(); // minLevel < 1
    expect(parseStoredLevelTitles([{ minLevel: 3, title: "Ок" }])).toEqual([
      { minLevel: 3, title: "Ок" },
    ]);
  });

  it("freezeCapForMilestone is 3 from level 10, else 2", () => {
    expect(freezeCapForMilestone(5)).toBe(2);
    expect(freezeCapForMilestone(10)).toBe(3);
    expect(freezeCapForMilestone(20)).toBe(3);
  });
});
