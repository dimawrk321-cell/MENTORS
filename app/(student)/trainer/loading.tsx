import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки хаба тренажёра (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока серверный компонент стримит очередь и статистику.
 */
export default function TrainerLoading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-7 w-40" />

      <div className="rounded-card flex flex-wrap items-center gap-4 border p-5">
        <Skeleton className="rounded-pill size-10" />
        <div className="min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-5 w-48" />
        </div>
        <Skeleton className="rounded-pill h-9 w-24" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="rounded-card h-20 w-full" />
        <Skeleton className="rounded-card h-20 w-full" />
        <Skeleton className="rounded-card h-20 w-full" />
      </div>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="rounded-card h-32 w-full" />
      </section>

      <Skeleton className="rounded-card h-24 w-full" />
    </div>
  );
}
