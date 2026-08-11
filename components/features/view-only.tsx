"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Режим «Глазами ученика» (spec 7.2) на клиенте.
//
// Просмотр строго read-only: каждая мутация отбивается на сервере
// (`assertNotImpersonating`). Но до этого захода клиент об этом не знал и узнавал
// отказ ТОЛЬКО в конце — красным тостом, уже после проделанной работы: набранной
// жалобы, отвеченного квиза, пройденного прогона свободной тренировки.
//
// Контекст даёт контролам узнать режим ЗАРАНЕЕ. Правило одно, два исполнения:
//   • поток без результата (форма, бронь, жалоба) — закрываем на входе и честно
//     объясняем строкой рядом;
//   • поток с результатом (прогон, сессия повторений) — доводим до конца и
//     считаем итог на клиенте, не записывая ничего.
//
// Значение приходит из серверного layout студзоны и focused-зоны; для обычного
// ученика оно всегда false, поэтому весь код ниже для него — no-op.

const ViewOnlyContext = createContext(false);

export function ViewOnlyProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <ViewOnlyContext.Provider value={value}>{children}</ViewOnlyContext.Provider>;
}

export function useViewOnly(): boolean {
  return useContext(ViewOnlyContext);
}

/** Тултип для закрытого контрола — одинаковый во всей зоне. */
export const VIEW_ONLY_TITLE = "Режим просмотра — изменения не сохраняются";

/**
 * Строка-объяснение рядом с закрытым контролом. Без неё выключенная кнопка
 * читается как поломка, а не как режим.
 */
export function ViewOnlyNote({
  children = "Режим просмотра: изменения не сохраняются.",
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-text-3 flex items-start gap-1.5 text-[13px]", className)}>
      <Eye size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
