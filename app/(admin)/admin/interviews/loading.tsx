import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелетон загрузки /admin/interviews (спец. 5.5): геометрия контента, не спиннер.
 * Показывается, пока server component стримит брони, страйки, рубрики и профили.
 */
export default function AdminInterviewsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-7 w-40" />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="rounded-pill h-9 w-28" />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="rounded-pill h-7 w-16" />
          ))}
        </div>
        <Skeleton className="rounded-card h-80 w-full" />
      </div>
    </div>
  );
}
