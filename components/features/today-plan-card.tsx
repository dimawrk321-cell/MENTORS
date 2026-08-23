import Link from "next/link";
import { BookOpen, CalendarClock, Layers, Play, TrendingDown } from "lucide-react";
import type { TodayPlan, TodayPlanKind } from "@/lib/utils/today-plan";
import { Card, CardContent } from "@/components/ui/card";

const ICONS = {
  mock: CalendarClock,
  srs: Layers,
  lesson: Play,
  weak: TrendingDown,
  courses: BookOpen,
} satisfies Record<TodayPlanKind, typeof Play>;

export function TodayPlanCard({ plan }: { plan: TodayPlan }) {
  const PrimaryIcon = ICONS[plan.primary.kind];
  return (
    <section className="flex flex-col gap-3" aria-labelledby="today-plan-title">
      <h2 id="today-plan-title" className="text-[18px] font-semibold tracking-[-0.01em]">
        Что делать сегодня
      </h2>
      <Card className="border-accent/25 overflow-hidden">
        <CardContent className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-start gap-3.5">
            <span
              className="bg-accent/12 text-accent flex size-10 shrink-0 items-center justify-center rounded-full"
              aria-hidden="true"
            >
              <PrimaryIcon size={19} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-text-3 text-[12px] font-medium tracking-wide uppercase">
                Главный шаг
              </p>
              <p className="text-text-1 mt-1 text-[18px] leading-snug font-semibold">
                {plan.primary.title}
              </p>
              <p className="text-text-2 mt-1 text-[13px]">{plan.primary.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={plan.primary.href}
              className="rounded-control ease-app inline-flex min-h-10 items-center gap-2 px-4 text-[14px] font-semibold text-white transition-transform duration-150 active:scale-[.98]"
              style={{ backgroundImage: "var(--gradient-accent)" }}
            >
              {plan.primary.actionLabel}
            </Link>
            {plan.secondary.map((item) => {
              const Icon = ICONS[item.kind];
              return (
                <Link
                  key={`${item.kind}:${item.href}`}
                  href={item.href}
                  title={item.description}
                  className="border-border text-text-2 hover:border-border-strong hover:text-text-1 rounded-control ease-app inline-flex min-h-10 items-center gap-1.5 border px-3 text-[13px] font-medium transition-colors duration-150"
                >
                  <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                  {item.actionLabel}
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
