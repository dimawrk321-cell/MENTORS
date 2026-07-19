import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки банка вопросов (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока серверный компонент тянет вопросы и категории при навигации.
 */
export default function AdminQuestionsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          <Skeleton className="rounded-pill h-9 w-32" />
          <Skeleton className="rounded-pill h-9 w-28" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="rounded-pill h-6 w-28" />
      </div>

      <Skeleton className="rounded-card h-96 w-full" />
    </div>
  );
}
