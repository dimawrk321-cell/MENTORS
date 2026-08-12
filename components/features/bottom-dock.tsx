"use client";

import { useEffect, useRef, type RefObject } from "react";
import { bottomDockOffset, type DockRect } from "@/lib/utils/bottom-dock";

// Регистр нижних доков экрана (spec 7.6/13, заход «Хвосты по тостам и высоте»).
//
// Зачем измерение, а не константа/CSS-переменная — DECISION в
// `lib/utils/bottom-dock.ts`. Здесь только DOM-часть: элемент регистрируется,
// его прямоугольник пересчитывается на resize/scroll/изменение размера, а итог
// уезжает в `--bottom-dock` на `<html>`. Потребитель — вьюпорт тостов
// (`.toast-viewport` в globals.css); любой следующий «плавающий» элемент внизу
// экрана может читать ту же переменную.
//
// Регистр — модульный, а не контекст: доки и потребители живут в разных ветках
// дерева (BottomNav в студзоне, панель оценок в focused-зоне, вьюпорт тостов в
// корневом layout), общего провайдера над ними нет.

const docks = new Set<HTMLElement>();
/** Плавающий потребитель — стек тостов. Его высота задаёт полосу, которую надо
 *  освободить: док учитывается, только если тост до него достаёт. */
let float: HTMLElement | null = null;
let observer: ResizeObserver | null = null;
let frame = 0;

function measure(): void {
  // Снимаем запланированный кадр: вызов мог прийти и напрямую (регистрация), и
  // из самого rAF — во втором случае отмена уже сработавшего кадра безвредна.
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  const rects: DockRect[] = [];
  for (const node of docks) {
    const rect = node.getBoundingClientRect();
    rects.push({ top: rect.top, height: rect.height, width: rect.width });
  }
  const offset = bottomDockOffset(
    rects,
    window.innerHeight,
    float?.getBoundingClientRect().height ?? 0,
  );
  document.documentElement.style.setProperty("--bottom-dock", `${offset}px`);
}

/**
 * Пересчёт не чаще кадра: scroll и resize приходят пачками.
 *
 * Только для потока событий. Регистрация и снятие меряют СИНХРОННО: на скрытой
 * вкладке `requestAnimationFrame` не выполняется вовсе, и первый замер повис бы
 * до момента, когда вкладку покажут.
 */
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(measure);
}

function attachListeners(): void {
  observer = new ResizeObserver(schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  // Мобильные браузеры прячут адресную строку — вьюпорт меняется без `resize`.
  window.visualViewport?.addEventListener("resize", schedule);
}

function detachListeners(): void {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("resize", schedule);
  window.removeEventListener("scroll", schedule);
  window.visualViewport?.removeEventListener("resize", schedule);
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  document.documentElement.style.setProperty("--bottom-dock", "0px");
}

/**
 * Помечает элемент нижним доком экрана. Вешать на сам контрол:
 * `<nav ref={useBottomDock<HTMLElement>()} data-bottom-dock>`.
 *
 * Атрибут `data-bottom-dock` логикой не используется — он маркер для отладки и
 * для проверочных прогонов в браузере (найти все доки страницы одним запросом).
 */
export function useBottomDock<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (docks.size === 0 && !float) attachListeners();
    docks.add(node);
    observer?.observe(node);
    measure();
    return () => {
      docks.delete(node);
      observer?.unobserve(node);
      if (docks.size === 0 && !float) detachListeners();
      else measure();
    };
  }, []);

  return ref;
}

/**
 * Помечает плавающий элемент, который поднимается над доками (вьюпорт тостов).
 * Его высота — та самая полоса у нижнего края: пока стек пуст, поднимать нечего
 * и ни один док не считается; появился тост — полоса выросла, и панель/навигация
 * под ним учитываются. Обратной связи нет: высота стека от его положения не
 * зависит (пояснение — в `lib/utils/bottom-dock.ts`).
 */
export function useBottomDockFloat<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (docks.size === 0 && !float) attachListeners();
    float = node;
    observer?.observe(node);
    measure();
    return () => {
      observer?.unobserve(node);
      float = null;
      if (docks.size === 0) detachListeners();
      else measure();
    };
  }, []);

  return ref;
}
