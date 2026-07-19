import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки Пульта (spec 5.5): геометрия контента, не спиннер. Показывается,
 * пока серверный компонент считает недельные метрики и красные флаги при навигации.
 */
export default function AdminDashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="rounded-card h-24 w-full" />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="rounded-card h-40 w-full" />
        ))}
        <Skeleton className="rounded-card h-40 w-full md:col-span-2" />
      </div>
    </div>
  );
}
