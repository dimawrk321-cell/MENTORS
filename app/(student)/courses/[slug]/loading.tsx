import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки курса (спец 5.5): геометрия контента, а не спиннер. Показывается,
 * пока серверный компонент стримит данные курса и дерево модулей при навигации.
 */
export default function CourseLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="mb-3 h-4 w-24" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="rounded-pill h-6 w-32" />
        </div>
        <Skeleton className="mt-1.5 h-4 w-full max-w-[64ch]" />
        <div className="mt-4 flex max-w-sm items-center gap-3">
          <Skeleton className="rounded-pill h-2 w-full" />
          <Skeleton className="h-4 w-8" />
        </div>
      </div>
      <Skeleton className="rounded-card h-64 w-full" />
    </div>
  );
}
