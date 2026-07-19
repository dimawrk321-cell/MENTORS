import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки профиля (spec 5.5): геометрия контента, не спиннер. Показываем,
 * пока серверный компонент тянет устройства, достижения и матрицу уведомлений.
 */
export default function ProfileLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-7 w-40" />

      <Skeleton className="rounded-card h-32 w-full" />
      <Skeleton className="rounded-card h-40 w-full" />
      <Skeleton className="rounded-card h-64 w-full" />
      <Skeleton className="rounded-card h-32 w-full" />
      <Skeleton className="rounded-card h-48 w-full" />

      <Skeleton className="rounded-pill h-9 w-24" />
    </div>
  );
}
