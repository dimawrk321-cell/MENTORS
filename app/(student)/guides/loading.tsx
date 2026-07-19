import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки /guides (спец. 5.5): геометрия контента, а не спиннер.
 * Показывается, пока серверный компонент читает закладки при переходе.
 */
export default function GuidesLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-full max-w-[60ch]" />
      </div>

      <section className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28" />
        <div className="flex flex-col gap-2">
          <Skeleton className="rounded-card h-14 w-full" />
          <Skeleton className="rounded-card h-14 w-full" />
          <Skeleton className="rounded-card h-14 w-full" />
        </div>
      </section>
    </div>
  );
}
