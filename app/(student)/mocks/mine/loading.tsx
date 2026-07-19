import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки /mocks/mine (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока сервер стримит списки предстоящих моков и истории.
 */
export default function MyMocksLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="rounded-pill h-8 w-32" />
      </div>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="rounded-card h-40 w-full" />
      </section>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="rounded-card h-40 w-full" />
      </section>
    </div>
  );
}
