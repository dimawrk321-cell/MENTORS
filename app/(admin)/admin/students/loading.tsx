import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки списка учеников (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока серверный компонент тянет реестр при навигации.
 */
export default function AdminStudentsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="rounded-pill h-9 w-36" />
          <Skeleton className="rounded-pill h-9 w-36" />
        </div>
      </div>

      <div className="flex max-w-md gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-24" />
      </div>

      <Skeleton className="rounded-card h-80 w-full" />
    </div>
  );
}
