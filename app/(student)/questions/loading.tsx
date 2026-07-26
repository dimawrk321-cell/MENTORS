import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет каталога вопросов (spec 5.5): геометрия контента, не спиннер.
 * Сворачиваемые секции категорий (walk 13.5 block 1) вместо сетки карточек.
 */
export default function QuestionsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-40" />

      {/* Поиск + кнопка */}
      <div className="flex max-w-md gap-2">
        <Skeleton className="rounded-control h-11 flex-1 md:h-9" />
        <Skeleton className="rounded-control h-11 w-24 md:h-9" />
      </div>

      {/* Один ряд чипов фильтров */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="rounded-pill h-7 w-20" />
        ))}
      </div>

      {/* Секции категорий */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="rounded-card h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
