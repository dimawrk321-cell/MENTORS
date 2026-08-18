"use client";

import { useState } from "react";
import { ModuleTree, type ModuleTreeModule } from "@/components/features/module-tree";
import { ModuleAccordion } from "@/components/features/module-accordion";
import { applyLessonFilter, type LessonFilter } from "@/lib/utils/course-program-filter";
import { pluralRu } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

// Программа курса (заход B.5, референс v2): заголовок «Программа», счётчик и
// фильтр «Все / Не пройдены / Видео» над списком модулей.
//
// Клиентский островок нужен ровно ради состояния фильтра — сами списки остаются
// прежними компонентами: `ModuleTree` (вид v2, ≥768px) и `ModuleAccordion`
// (мобильный аккордеон из захода 12.3, <768px). Второго рендера программы не
// заводится: фильтр отдаёт обоим один и тот же отфильтрованный массив.

const FILTERS: { key: LessonFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "todo", label: "Не пройдены" },
  { key: "video", label: "Видео" },
];

export function CourseProgram({ modules }: { modules: ModuleTreeModule[] }) {
  const [filter, setFilter] = useState<LessonFilter>("all");
  // Правило фильтра — чистая функция под тестами (lib/utils/course-program-filter).
  const shown = applyLessonFilter(modules, filter);

  const totalLessons = modules.reduce((sum, module) => sum + module.lessons.length, 0);
  const meta = `${totalLessons} ${pluralRu(totalLessons, "урок", "урока", "уроков")} в ${modules.length} ${pluralRu(modules.length, "модуле", "модулях", "модулях")}`;

  return (
    <section>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Программа</h2>
        <span className="text-text-3 text-[12px]">{meta}</span>
        <div
          role="group"
          aria-label="Фильтр уроков"
          className="border-border bg-surface-1 ml-auto flex items-center gap-0.5 rounded-[10px] border p-0.5"
        >
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              aria-pressed={filter === item.key}
              className={cn(
                "ease-app h-7 rounded-[8px] px-2.5 text-[12px] font-medium transition-colors duration-150",
                filter === item.key
                  ? "bg-surface-2 text-text-1"
                  : "text-text-3 hover:text-text-2 bg-transparent",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        // Пустой результат фильтра (spec 5.5): не пустое место, а выход из него.
        <p className="text-text-3 border-border rounded-card border border-dashed px-4 py-6 text-center text-[13px]">
          {filter === "video" ? "В этом курсе нет уроков с видео." : "Все уроки курса пройдены."}{" "}
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="text-accent hover:text-accent-hover ease-app transition-colors duration-150"
          >
            Показать все
          </button>
        </p>
      ) : (
        <>
          {/* Desktop/планшет — плашки v2; <768px — аккордеон модулей (12.3). */}
          <div className="hidden md:block">
            <ModuleTree modules={shown} />
          </div>
          <div className="md:hidden">
            <ModuleAccordion modules={shown} />
          </div>
        </>
      )}
    </section>
  );
}
