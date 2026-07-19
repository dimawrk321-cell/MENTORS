import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки /admin/library (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока серверный компонент тянет список записей при навигации.
 */
export default function AdminLibraryLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="rounded-pill h-9 w-36" />
      </div>

      <div className="rounded-card border-border bg-surface-1 flex flex-col gap-2 border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <Skeleton className="h-4 w-24 shrink-0" />
            <Skeleton className="rounded-pill h-7 w-20" />
            <Skeleton className="rounded-pill h-7 w-24" />
            <Skeleton className="rounded-pill h-7 w-16" />
          </div>
        ))}
      </div>

      <div className="rounded-card border-border flex flex-col gap-3 border p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
