"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// :::spoiler{title="…"} — блок «Скрытый ответ» (заход B.1).
//
// Заголовок виден всегда, тело свёрнуто и разворачивается по клику. Состояние
// НЕ сохраняется между заходами: спойлер — приём чтения («попробуй ответить
// сам»), а не настройка; при следующем открытии урока вопрос снова должен
// заставить подумать. Поэтому ни localStorage, ни lesson_progress здесь нет.
//
// Доступность (spec 14): нативный <details>/<summary> даёт клавиатуру (Enter и
// Space), роль кнопки и объявление состояния бесплатно; aria-expanded ставится
// явно и синхронизируется по событию toggle — требование задания и страховка от
// движков, которые состояние summary не экспонируют.
//
// Печать (DECISION): напечатанный урок — статичная бумага, кликнуть по ней
// нельзя, поэтому спойлер печатается РАЗВЁРНУТЫМ. Держится двумя способами:
// beforeprint открывает <details> (работает во всех целевых движках), а правило
// `@media print` в globals.css перекрывает UA-скрытие тела на случай печати без
// JS (например, из PDF-конвертера).

export function Spoiler({ title, children }: { title?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const openForPrint = () => {
      if (ref.current) ref.current.open = true;
    };
    window.addEventListener("beforeprint", openForPrint);
    return () => window.removeEventListener("beforeprint", openForPrint);
  }, []);

  return (
    <details
      ref={ref}
      className="lesson-spoiler border-border bg-surface-1 my-5 rounded-[12px] border"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-expanded={open}
        /* outline-offset внутрь: кольцо фокуса на самом краю карточки обрезалось
           её скруглением и читалось как случайная полоска (spec 14). */
        className="hover:text-text-1 ease-app flex min-h-11 cursor-pointer list-none items-start gap-2.5 rounded-[12px] px-4 py-3 text-[15px] font-medium outline-offset-[-2px] transition-colors duration-150 select-none [&::-webkit-details-marker]:hidden"
      >
        <EyeOff
          size={15}
          strokeWidth={1.75}
          className="text-text-3 mt-1 shrink-0"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">{title?.trim() || "Скрытый ответ"}</span>
        <span className="text-text-3 mt-0.5 flex shrink-0 items-center gap-1 text-[12px]">
          <span className="spoiler-hint">{open ? "Свернуть" : "Показать ответ"}</span>
          <ChevronDown
            size={15}
            strokeWidth={1.75}
            className={cn("ease-app transition-transform duration-200", open && "rotate-180")}
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="spoiler-body border-border text-text-2 border-t px-4 py-3">{children}</div>
    </details>
  );
}
