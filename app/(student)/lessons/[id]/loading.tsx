import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки урока (спец 5.5): геометрия контента, а не спиннер. Показывается,
 * пока серверный компонент готовит текст урока, ключевые вопросы и квиз при переходе.
 */
export default function LessonLoading() {
  return (
    <div className="flex gap-10">
      <div className="mx-auto w-full max-w-[680px] min-w-0">
        <Skeleton className="rounded-pill mb-3 h-4 w-64" />
        <Skeleton className="h-9 w-3/4" />
        <div className="mt-2.5 mb-5 flex flex-wrap items-center gap-2">
          <Skeleton className="rounded-pill h-6 w-16" />
          <Skeleton className="rounded-pill h-6 w-24" />
          <Skeleton className="rounded-control ml-auto h-8 w-28" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="rounded-card my-2 h-56 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
      <aside className="hidden w-56 shrink-0 xl:block">
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
