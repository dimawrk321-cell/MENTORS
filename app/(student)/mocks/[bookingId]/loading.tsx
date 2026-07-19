import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет страницы мока (spec 5.5): геометрия контента, а не спиннер. Показывается,
 * пока серверный компонент подгружает детали брони и опубликованный фидбек.
 */
export default function BookingDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-5 w-24" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="rounded-pill h-6 w-24" />
        </div>
        <Skeleton className="h-5 w-64" />
      </div>
      <section className="flex flex-col gap-3">
        <Skeleton className="rounded-card h-40 w-full" />
        <Skeleton className="rounded-card h-24 w-full" />
      </section>
    </div>
  );
}
