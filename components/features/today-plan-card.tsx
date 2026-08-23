import Link from "next/link";
import { BookOpen, CalendarClock, Layers, Play, TrendingDown } from "lucide-react";
import type { TodayPlan, TodayPlanKind } from "@/lib/utils/today-plan";
import { CardContent } from "@/components/ui/card";

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
      <div
        className="relative overflow-hidden rounded-[18px] text-white"
        style={{
          backgroundImage:
            "radial-gradient(640px 220px at 88% -30%, rgb(255 255 255 / 0.28), transparent 70%), radial-gradient(400px 180px at 8% 120%, rgb(255 255 255 / 0.12), transparent 70%), var(--gradient-accent)",
          boxShadow: "0 12px 40px color-mix(in srgb, var(--accent) 25%, transparent)",
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-[60px] size-[260px] rounded-full border-[32px] border-white/8"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[120px] -bottom-[110px] size-[220px] rounded-full border-[26px] border-white/6"
        />
        <CardContent className="relative flex flex-col gap-5 p-5 sm:p-7">
          <div className="flex items-start gap-3.5">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/18 text-white"
              aria-hidden="true"
            >
              <PrimaryIcon size={19} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium tracking-wide text-white/70 uppercase">
                Главный шаг
              </p>
              <p className="mt-1 text-[20px] leading-snug font-semibold text-white">
                {plan.primary.title}
              </p>
              <p className="mt-1 text-[13px] text-white/80">{plan.primary.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={plan.primary.href}
              className="text-accent rounded-control ease-app inline-flex min-h-10 items-center gap-2 bg-white px-4 text-[14px] font-semibold transition-transform duration-150 hover:-translate-y-px active:scale-[.98]"
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
                  className="rounded-control ease-app inline-flex min-h-10 items-center gap-1.5 border border-white/25 bg-white/8 px-3 text-[13px] font-medium text-white/90 transition-colors duration-150 hover:border-white/45 hover:bg-white/14 hover:text-white"
                >
                  <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                  {item.actionLabel}
                </Link>
              );
            })}
          </div>
        </CardContent>
      </div>
    </section>
  );
}
