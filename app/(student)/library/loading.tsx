import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки библиотеки (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока серверный компонент стримит каталог записей.
 */
export default function LibraryLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="rounded-card border-border bg-surface-1 flex flex-col gap-2 border p-4">
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="flex flex-wrap items-center gap-1.5">
            <Skeleton className="h-5 w-24 shrink-0" />
            {Array.from({ length: 5 }).map((_, pill) => (
              <Skeleton key={pill} className="rounded-pill h-7 w-20" />
            ))}
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, card) => (
          <Skeleton key={card} className="rounded-card h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
