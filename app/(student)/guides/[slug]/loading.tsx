import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет чтения гайда (спец 5.5): геометрия читальной колонки, а не спиннер.
 * Собственный boundary у [slug] нужен, чтобы при открытии главы не мигал скелет
 * СПИСКА из /guides — соседний по разделу («Читалка v2»).
 */
export default function GuideLoading() {
  return (
    <div className="flex gap-10">
      <div className="mx-auto w-full max-w-[680px] min-w-0">
        <Skeleton className="rounded-pill mb-3 h-4 w-32" />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="rounded-pill h-6 w-24" />
          <Skeleton className="rounded-control h-8 w-40" />
        </div>
        {/* «Глава X из Y» + сегментированный индикатор. */}
        <Skeleton className="rounded-pill mb-2 h-3 w-28" />
        <Skeleton className="rounded-pill mb-3.5 h-1 w-full" />
        <Skeleton className="mb-4 h-9 w-3/4" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="rounded-card my-2 h-40 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
        </div>
      </div>
      {/* Тот же брейкпоинт, что у боевого оглавления (LessonTocRail). */}
      <aside className="hidden w-56 shrink-0 min-[1180px]:block">
        <Skeleton className="mb-2 h-3 w-24" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-4/6" />
        </div>
      </aside>
    </div>
  );
}
