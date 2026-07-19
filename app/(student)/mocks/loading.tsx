import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки /mocks (spec 5.5): геометрия контента, а не спиннер. Показывается,
 * пока серверный компонент подтягивает брони и предложения при навигации.
 */
export default function MocksLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />

      <section className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="rounded-card h-24 w-full" />
      </section>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-6 w-44" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="rounded-card h-28 w-full" />
          <Skeleton className="rounded-card h-28 w-full" />
        </div>
      </section>

      <Skeleton className="h-4 w-40" />
    </div>
  );
}
