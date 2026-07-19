import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки контент-студии (spec 5.5): геометрия дерева курсов, не спиннер.
 * Показывается, пока серверный компонент стримит дерево курсов при навигации.
 */
export default function AdminContentLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* Вкладки студии: «Курсы» / «Справочник» */}
      <div className="border-border flex items-center gap-1 border-b">
        <Skeleton className="h-9 w-16" />
        <Skeleton className="h-9 w-24" />
      </div>
      {/* Заголовок «Контент» + кнопка «Курс» */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-9 w-24" />
      </div>
      {/* Дерево курсов: карточки с вложенными модулями */}
      <div className="flex flex-col gap-3">
        <Skeleton className="rounded-card h-40 w-full" />
        <Skeleton className="rounded-card h-32 w-full" />
        <Skeleton className="rounded-card h-24 w-full" />
      </div>
    </div>
  );
}
