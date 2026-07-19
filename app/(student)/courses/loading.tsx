import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки каталога курсов (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока серверный компонент стримит список курсов при навигации.
 */
export default function CoursesLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-7 w-40" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="mt-auto flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="rounded-pill h-6 w-32" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="rounded-pill h-2 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
