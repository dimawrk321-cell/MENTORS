import { describe, it, expect } from "vitest";
import { isOpenPaletteHotkey } from "@/lib/palette-logic";
import {
  isToggleSidebarHotkey,
  normalizeSidebarState,
  toggleSidebarState,
} from "@/lib/sidebar-logic";

// Заход B.3, боковая панель: чистая логика состояния и горячей клавиши.
// Геометрию тут не проверяем — её держит CSS (globals.css), а jsdom в проекте
// нет; предмет теста — согласованность клавиш и нормализация сохранённого выбора.

describe("боковая панель — сохранённое состояние", () => {
  it("свёрнутой считается только явная запись «collapsed»", () => {
    expect(normalizeSidebarState("collapsed")).toBe("collapsed");
    expect(normalizeSidebarState("expanded")).toBe("expanded");
  });

  it("пустое хранилище и мусор читаются как развёрнутая панель", () => {
    expect(normalizeSidebarState(null)).toBe("expanded");
    expect(normalizeSidebarState(undefined)).toBe("expanded");
    expect(normalizeSidebarState("")).toBe("expanded");
    expect(normalizeSidebarState("Collapsed")).toBe("expanded");
  });

  it("переключение возвращается в исходное за два шага", () => {
    expect(toggleSidebarState("expanded")).toBe("collapsed");
    expect(toggleSidebarState(toggleSidebarState("expanded"))).toBe("expanded");
  });
});

describe("боковая панель — горячая клавиша", () => {
  it("срабатывает на Cmd+\\ и Ctrl+\\", () => {
    expect(isToggleSidebarHotkey({ metaKey: true, ctrlKey: false, key: "\\" })).toBe(true);
    expect(isToggleSidebarHotkey({ metaKey: false, ctrlKey: true, key: "\\" })).toBe(true);
  });

  it("берёт физическую клавишу, когда раскладка не даёт «\\»", () => {
    expect(
      isToggleSidebarHotkey({ metaKey: false, ctrlKey: true, key: "/", code: "Backslash" }),
    ).toBe(true);
  });

  it("игнорирует «\\» без модификатора и с лишними модификаторами", () => {
    expect(isToggleSidebarHotkey({ metaKey: false, ctrlKey: false, key: "\\" })).toBe(false);
    expect(isToggleSidebarHotkey({ metaKey: false, ctrlKey: true, altKey: true, key: "\\" })).toBe(
      false,
    );
    expect(
      isToggleSidebarHotkey({ metaKey: false, ctrlKey: true, shiftKey: true, key: "\\" }),
    ).toBe(false);
  });

  // Главное свойство: две глобальные горячие клавиши зоны не пересекаются.
  it("не пересекается с ⌘K командной палитры (spec 7.11)", () => {
    const palette = { metaKey: true, ctrlKey: false, key: "k", code: "KeyK" };
    expect(isOpenPaletteHotkey(palette)).toBe(true);
    expect(isToggleSidebarHotkey(palette)).toBe(false);

    const sidebar = { metaKey: true, ctrlKey: false, key: "\\", code: "Backslash" };
    expect(isToggleSidebarHotkey(sidebar)).toBe(true);
    expect(isOpenPaletteHotkey(sidebar)).toBe(false);
  });

  // Клавиши тренажёра (spec 14) — голые, без модификаторов: Space и 1/2/3.
  it("не перехватывает клавиши тренажёра", () => {
    for (const key of [" ", "1", "2", "3"]) {
      expect(isToggleSidebarHotkey({ metaKey: false, ctrlKey: false, key })).toBe(false);
      expect(isToggleSidebarHotkey({ metaKey: true, ctrlKey: false, key })).toBe(false);
    }
  });
});
