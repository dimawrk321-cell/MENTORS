"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { ANALYTICS_PERIODS } from "@/lib/constants";

// Course + period selectors for /admin/analytics — они пишут выбор в searchParams,
// страница (server) перезагружает агрегаты. Никакого клиентского состояния данных.

function useUpdateParam() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (key: string, value: string) => {
    const params = new URLSearchParams(sp);
    params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  };
}

export function CourseSelect({
  courses,
  courseId,
}: {
  courses: { id: string; title: string }[];
  courseId: string;
}) {
  const update = useUpdateParam();
  return (
    <select
      aria-label="Курс"
      value={courseId}
      onChange={(e) => update("course", e.target.value)}
      className="rounded-control border-border text-text-1 ease-app hover:border-border-strong h-9 border bg-transparent px-3 text-[14px] transition-colors duration-150"
    >
      {courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      ))}
    </select>
  );
}

export function PeriodTabs({ period }: { period: number }) {
  const update = useUpdateParam();
  return (
    <div className="rounded-control border-border inline-flex border p-0.5">
      {ANALYTICS_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => update("period", String(p))}
          className={cn(
            "rounded-[8px] px-3 py-1 text-[13px] transition-colors duration-150",
            period === p ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
          )}
        >
          {p} дней
        </button>
      ))}
    </div>
  );
}
