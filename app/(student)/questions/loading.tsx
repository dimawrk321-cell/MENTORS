import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет каталога вопросов (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока server component стримит категории и каталог.
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

      {/* Категории — цветные чипы */}
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="rounded-pill h-8 w-24" />
        ))}
      </div>

      {/* Тип, сложность и «мои западающие» */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="rounded-pill h-7 w-20" />
        ))}
      </div>

      {/* Сетка карточек-вопросов */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="rounded-card h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
