import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки аналитики (спек 5.5): геометрия контента, не спиннер. Показывается,
 * пока серверный компонент стримит агрегаты виджетов при навигации.
 */
export default function AdminAnalyticsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="rounded-pill h-9 w-40" />
      </div>
      <Skeleton className="rounded-card h-48 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="rounded-card h-56 w-full" />
        <Skeleton className="rounded-card h-56 w-full" />
      </div>
      <Skeleton className="rounded-card h-56 w-full" />
      <Skeleton className="rounded-card h-40 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="rounded-card h-48 w-full" />
        <Skeleton className="rounded-card h-48 w-full" />
      </div>
    </div>
  );
}
