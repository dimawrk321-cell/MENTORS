import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function GuideSectionLoading() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5" aria-label="Загрузка раздела">
      <div className="flex items-start gap-3.5">
        <Skeleton className="size-11 shrink-0 rounded-[12px]" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-8 w-44" />
          <Skeleton className="mt-2 h-4 w-full max-w-[560px]" />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-1 w-full rounded-full" />
        </CardContent>
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-[72px] w-full rounded-[14px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
