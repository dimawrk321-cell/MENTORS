"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

// Мультивыбор категорий банка для формы курса (заход «Банк вопросов», A1).
//
// Список ПОЛНЫЙ и ручной: связи проставляются сразу, не дожидаясь привязок
// вопрос→урок (их пока мало, и после разметки банка картина изменится). Отсюда
// же требования — поиск по названию, счётчик опубликованных вопросов у каждой
// строки и видимая вложенность: без счётчика ментор не отличит живую категорию
// от пустой заготовки.
//
// Выбор корня НЕ проставляет детей автоматически: доступ и так наследуется вниз
// по дереву (lib/services/question-access.ts), а массовая простановка потом
// мешала бы снять одну подкатегорию.

export interface CategoryOption {
  id: string;
  title: string;
  parentId: string | null;
  questions: number;
}

export function CategoryMultiSelect({
  options,
  value,
  onChange,
}: {
  options: CategoryOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(value), [value]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const byId = new Map(options.map((o) => [o.id, o]));
    const hit = new Set<string>();
    for (const option of options) {
      if (!option.title.toLowerCase().includes(q)) continue;
      hit.add(option.id);
      // Родитель совпавшей подкатегории остаётся, чтобы не терялась вложенность.
      if (option.parentId && byId.has(option.parentId)) hit.add(option.parentId);
    }
    return options.filter((o) => hit.has(o.id));
  }, [options, query]);

  const toggle = (id: string) =>
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-text-2 text-[13px]">
          Категории банка вопросов
          {value.length > 0 && (
            <span className="text-text-3 ml-2 tabular-nums">выбрано {value.length}</span>
          )}
        </span>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-text-3 hover:text-text-1 ease-app text-[12px] transition-colors duration-150"
          >
            Снять все
          </button>
        )}
      </div>
      <p className="text-text-3 text-[12px]">
        Открытие курса ученику открывает и эти категории. Категории, не привязанные ни к одному
        курсу, видны всем.
      </p>

      <div className="relative">
        <Search
          size={14}
          strokeWidth={1.75}
          className="text-text-3 absolute top-1/2 left-3 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск категории"
          aria-label="Поиск категории"
          className="pl-8"
        />
      </div>

      {/* Заход B.6: потолок был `max-h-64` (256px) — из 58 категорий помещалось
          ~9 строк, и владелец листал список щелью на каждой простановке связи
          курс↔категория. `min(26rem, 45dvh)`: на десктопе ~416px (~14 строк), на
          невысоком вьюпорте список сжимается сам, чтобы диалог не стал простынёй
          (у DialogContent свой `max-h-[calc(100dvh-2rem)]`). */}
      <div className="rounded-control border-border flex max-h-[min(26rem,45dvh)] flex-col overflow-y-auto border p-1">
        {visible.length === 0 ? (
          <p className="text-text-3 p-2 text-[12px]">Ничего не нашлось.</p>
        ) : (
          visible.map((option) => {
            const active = selected.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => toggle(option.id)}
                className={cn(
                  "rounded-control ease-app flex items-center gap-2 px-2 py-1.5 text-left text-[13px] transition-colors duration-150",
                  option.parentId && "pl-7",
                  active ? "bg-accent/10 text-text-1" : "text-text-2 hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                    active ? "border-accent bg-accent text-white" : "border-border",
                  )}
                  aria-hidden="true"
                >
                  {active && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.title}</span>
                <span className="text-text-3 shrink-0 text-[11px] tabular-nums">
                  {option.questions}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
