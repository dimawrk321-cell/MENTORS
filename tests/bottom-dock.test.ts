import { describe, expect, it } from "vitest";
import { bottomDockOffset, DOCK_GAP_PX, type DockRect } from "@/lib/utils/bottom-dock";

// Заход «Хвосты по тостам и высоте». Отступ тостов был константой 4.75rem —
// высотой BottomNav. Но BottomNav монтируется только в студзоне и только
// <768px: в focused-зоне внизу стоит липкая панель оценок, на странице курса —
// липкая CTA. Здесь проверяется чистый подсчёт «занятой полосы» (jsdom в
// проекте нет — DOM живёт в components/features/bottom-dock.tsx).

const VIEWPORT = 844; // 390×844 — эталонный мобильный вьюпорт spec 13

/** Высота одного компактного тоста — замер на 390px. */
const TOAST = 52;

/** BottomNav на 390×844 в браузере без выреза: 57px (56 + hairline), прижат к низу. */
const bottomNav: DockRect = { top: VIEWPORT - 57, height: 57, width: 390 };

describe("нижний док экрана", () => {
  it("без доков отступ нулевой — работает голый env(safe-area-inset-bottom)", () => {
    expect(bottomDockOffset([], VIEWPORT, TOAST)).toBe(0);
  });

  it("каталог: полоса считается по BottomNav", () => {
    expect(bottomDockOffset([bottomNav], VIEWPORT, TOAST)).toBe(57);
  });

  it("сессия повторений: полоса считается по панели оценок, а не по навигации", () => {
    // Замер на альбомном 844×390: панель прилипла к низу, верхняя граница 302.
    const stuckPanel: DockRect = { top: 302, height: 88, width: 672 };
    expect(bottomDockOffset([stuckPanel], 390, TOAST)).toBe(88);
  });

  it("CTA курса поверх навигации: берётся самый высокий док", () => {
    // Замер на 390×844: CTA стоит над BottomNav, нижняя граница 787.
    const courseCta: DockRect = { top: 739, height: 48, width: 358 };
    expect(bottomDockOffset([bottomNav, courseCta], VIEWPORT, TOAST)).toBe(105);
  });

  it("скрытый док (md:hidden — display:none) не считается", () => {
    const hidden: DockRect = { top: 0, height: 0, width: 0 };
    expect(bottomDockOffset([hidden], VIEWPORT, TOAST)).toBe(0);
  });

  it("панель, до которой тост не достаёт, доком не считается", () => {
    // Короткий эталон на 390×844: дека помещается в экран целиком, липкая
    // панель стоит по месту (453…513) и тосту у нижнего края не мешает —
    // гнать тост на середину экрана незачем.
    const restingPanel: DockRect = { top: 453, height: 60, width: 358 };
    expect(restingPanel.top + restingPanel.height).toBeLessThan(VIEWPORT - DOCK_GAP_PX - TOAST);
    expect(bottomDockOffset([restingPanel], VIEWPORT, TOAST)).toBe(0);
  });

  it("полоса растёт вместе со стеком: высокий стек начинает видеть тот же док", () => {
    const restingPanel: DockRect = { top: 453, height: 60, width: 358 };
    // Два danger-тоста с описанием в три строки — стек выше, до панели достаёт.
    expect(bottomDockOffset([restingPanel], VIEWPORT, 320)).toBe(391);
  });

  it("пустой стек не поднимает ничего лишнего", () => {
    const restingPanel: DockRect = { top: 453, height: 60, width: 358 };
    expect(bottomDockOffset([restingPanel], VIEWPORT, 0)).toBe(0);
  });

  it("док не может съесть больше половины экрана", () => {
    const huge: DockRect = { top: 0, height: VIEWPORT, width: 390 };
    expect(bottomDockOffset([huge], VIEWPORT, TOAST)).toBe(VIEWPORT / 2);
  });

  it("вырожденный вьюпорт не ломает подсчёт", () => {
    expect(bottomDockOffset([bottomNav], 0, TOAST)).toBe(0);
  });
});
