import { Flame, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { dateOnlyUtc, formatDateOnlyRu, isoWeekday, pluralRu } from "@/lib/utils/dates";
import type { ActivityBarCell, ActivityBarData } from "@/lib/services/dashboard";

// Activity block (design handoff «Главная v2»): a header with a flame + gradient
// streak number + freezes, then the last 14 days as a discrete weekday grid — each
// day a rounded bar whose green intensity tracks the day's XP («темнее = больше XP»),
// today ringed in accent. Supersedes the walk-13.5 A/B lane variants.

export interface ActivityStreak {
  current: number;
  freezes: number;
  atRisk: boolean;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** XP → green intensity: any active day floors at 22%, a heavy (~120 XP) day is full. */
function cellBackground(cell: ActivityBarCell): string {
  if (cell.xp <= 0 && cell.actions <= 0) return "var(--heat-empty)";
  const t = cell.xp > 0 ? Math.min(1, cell.xp / 120) : 0;
  const pct = Math.round(22 + 78 * t);
  return `color-mix(in srgb, var(--success) ${pct}%, transparent)`;
}

function cellTitle(cell: ActivityBarCell): string {
  const date = formatDateOnlyRu(dateOnlyUtc(cell.date));
  const actions = `${cell.actions} ${pluralRu(cell.actions, "действие", "действия", "действий")}`;
  return `${date} · ${cell.xp} XP · ${actions}`;
}

export function ActivityBar({ data, streak }: { data: ActivityBarData; streak: ActivityStreak }) {
  const cells = data.days.slice(-14);
  return (
    <div className="flex flex-col gap-3.5">
      {/* Заголовок: пламя + градиентная цифра серии + заморозки. */}
      <div className="flex items-center gap-3">
        <Flame
          size={26}
          strokeWidth={1.75}
          className={streak.atRisk ? "text-warning" : "text-accent"}
          aria-hidden="true"
        />
        <div className="flex items-baseline gap-1.5">
          <span
            className="bg-clip-text text-[26px] font-bold text-transparent tabular-nums"
            style={{ backgroundImage: "var(--gradient-accent)" }}
          >
            {streak.current}
          </span>
          <span className="text-text-3 text-[13px]">
            {pluralRu(streak.current, "день", "дня", "дней")} подряд
          </span>
        </div>
        <span
          className="text-text-3 ml-auto inline-flex items-center gap-1 text-[12px]"
          title="Заморозки серии"
        >
          <Snowflake size={13} strokeWidth={1.75} aria-hidden="true" />
          {streak.freezes} {pluralRu(streak.freezes, "заморозка", "заморозки", "заморозок")}
        </span>
      </div>

      {/* Дискретная сетка 14 дней с подписями дней недели. */}
      <div>
        <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5">
          {cells.map((cell) => {
            const weekday = WEEKDAYS[isoWeekday(cell.date) - 1];
            return (
              <div key={cell.date} title={cellTitle(cell)} className="flex min-w-0 flex-col gap-1">
                <div
                  className={cn(
                    "h-[30px] rounded-[7px]",
                    cell.isToday && "ring-accent ring-1 ring-inset",
                  )}
                  style={{ background: cellBackground(cell) }}
                />
                <span
                  className={cn(
                    "text-center text-[10px] leading-none",
                    cell.isToday ? "text-text-1 font-semibold" : "text-text-3",
                  )}
                >
                  {weekday}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-text-3 mt-2 text-[11px]">последние 2 недели · темнее = больше XP</p>
      </div>
    </div>
  );
}
