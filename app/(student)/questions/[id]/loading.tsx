import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелетон просмотра вопроса (spec 5.5): геометрия FlipCard, а не спиннер.
 * Показывается, пока сервер стримит вопрос при переходе.
 */
export default function QuestionLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Skeleton className="rounded-pill h-6 w-24" />
      <div className="rounded-card border-border bg-surface flex min-h-[300px] flex-col gap-4 border p-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <Skeleton className="rounded-pill h-6 w-32" />
          <Skeleton className="rounded-pill h-6 w-20" />
          <Skeleton className="rounded-pill h-6 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </div>
      <div className="flex justify-center">
        <Skeleton className="rounded-pill h-10 w-40" />
      </div>
    </div>
  );
}
