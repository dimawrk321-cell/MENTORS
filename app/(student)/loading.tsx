import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard loading skeleton (spec 5.5): content geometry, not a spinner. Shown
 * while the server component streams its aggregates on navigation.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* greeting + goal ring */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="rounded-pill h-6 w-56" />
        </div>
        <Skeleton className="rounded-pill size-16" />
      </div>
      {/* hero «Продолжить» */}
      <Skeleton className="rounded-card h-32 w-full" />
      {/* «Сегодня» */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="rounded-card h-20 w-full" />
      </div>
      {/* курсы */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-20" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="rounded-card h-24 w-full" />
          <Skeleton className="rounded-card h-24 w-full" />
        </div>
      </div>
      {/* активность */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="rounded-card h-40 w-full" />
      </div>
    </div>
  );
}
