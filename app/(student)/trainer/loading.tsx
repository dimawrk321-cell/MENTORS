import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелет загрузки хаба тренажёра (spec 5.5): геометрия контента, не спиннер.
 * Показывается, пока серверный компонент стримит очередь и статистику.
 */
export default function TrainerLoading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Skeleton className="h-[34px] w-40" />
          <Skeleton className="mt-2 h-4 w-[min(420px,80vw)]" />
        </div>
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 max-[1080px]:grid-cols-1">
        <Skeleton className="rounded-card h-[266px] w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="rounded-card h-[126px] w-full" />
          <Skeleton className="rounded-card h-[124px] w-full" />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 max-[1080px]:grid-cols-1">
        <Skeleton className="rounded-card h-[238px] w-full" />
        <Skeleton className="rounded-card h-[238px] w-full" />
      </div>

      <Skeleton className="rounded-card h-[210px] w-full" />

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 max-[1080px]:grid-cols-1">
        <Skeleton className="rounded-card h-[78px] w-full" />
        <Skeleton className="rounded-card h-[78px] w-full" />
      </div>
    </div>
  );
}
