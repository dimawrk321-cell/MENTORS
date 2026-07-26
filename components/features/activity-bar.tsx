import { Flame, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { dateOnlyUtc, formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import type { ActivityBarCell, ActivityBarData } from "@/lib/services/dashboard";

// Activity block (walk 13.5 block 2): a reworked streak strip replacing the retired
// heatmap grid. TWO variants live behind a prop (owner picks one after review; the
// other is then removed). Default A. Both themes, 390px, native «дата · XP» tooltip.
//
//  A «Лента-градиент» — the last 28 days merge into a single rounded track, green
//    intensity a smooth gradient by the day's XP, today accented; a big streak number
//    (flame + «N дней подряд») is the focal point on the left, the strip is backdrop.
//  B «Крупные точки» — 14 large dots (filled = active day, empty = thin outline),
//    caption «2 недели», streak + freezes to the side. Minimal, lots of air.
//
// Spec 5.6 «без эмодзи в интерфейсе»: the streak flame is a Lucide icon, not 🔥.

export type ActivityVariant = "A" | "B";

export interface ActivityStreak {
  current: number;
  freezes: number;
  atRisk: boolean;
}

/** XP → full intensity around a heavy day (~120 XP); any active day floors at 22%. */
function laneBackground(cell: ActivityBarCell): string {
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

const daysWord = (n: number) => pluralRu(n, "день", "дня", "дней");

function StreakFocal({ streak, size = "lg" }: { streak: ActivityStreak; size?: "lg" | "sm" }) {
  const big = size === "lg";
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <Flame
        size={big ? 24 : 18}
        strokeWidth={1.75}
        className={streak.atRisk ? "text-warning" : "text-accent"}
        aria-hidden="true"
      />
      <div className="leading-none">
        <div className={cn("font-semibold tabular-nums", big ? "text-[26px]" : "text-[18px]")}>
          {streak.current}
        </div>
        <div className="text-text-3 mt-1 text-[12px]">{daysWord(streak.current)} подряд</div>
      </div>
      {streak.freezes > 0 && (
        <span
          className="text-text-3 ml-1 inline-flex items-center gap-0.5 self-start text-[12px]"
          title="Заморозки серии"
        >
          <Snowflake size={13} strokeWidth={1.75} aria-hidden="true" />
          {streak.freezes}
        </span>
      )}
    </div>
  );
}

/** Variant A: focal streak + merged gradient lane of the last 28 days. */
function LaneVariant({ data, streak }: { data: ActivityBarData; streak: ActivityStreak }) {
  const spanDays = data.days.length - 1;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
      <StreakFocal streak={streak} />
      <div className="min-w-0 flex-1">
        <div className="rounded-pill flex h-8 overflow-hidden">
          {data.days.map((cell) => (
            <div
              key={cell.date}
              title={cellTitle(cell)}
              className={cn("h-full flex-1", cell.isToday && "ring-accent z-10 ring-2 ring-inset")}
              style={{ background: laneBackground(cell) }}
            />
          ))}
        </div>
        <div className="text-text-3 mt-1.5 flex items-center justify-between text-[11px]">
          <span>−{spanDays} дней</span>
          <span>сегодня</span>
        </div>
      </div>
    </div>
  );
}

/** Variant B: 14 large dots (filled = active), streak + freezes to the side. */
function DotsVariant({ data, streak }: { data: ActivityBarData; streak: ActivityStreak }) {
  const dots = data.days.slice(-14);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-2">
          {dots.map((cell) => {
            const active = cell.xp > 0 || cell.actions > 0;
            return (
              <span
                key={cell.date}
                title={cellTitle(cell)}
                aria-hidden="true"
                className={cn(
                  "size-4 rounded-full",
                  active ? "bg-success" : "border-border-strong border",
                  cell.isToday && "ring-accent ring-offset-surface-1 ring-2 ring-offset-2",
                )}
              />
            );
          })}
        </div>
        <span className="text-text-3 text-[12px]">2 недели</span>
      </div>
      <div className="text-text-2 flex shrink-0 items-center gap-4 text-[13px]">
        <span className="inline-flex items-center gap-1.5">
          <Flame
            size={15}
            strokeWidth={1.75}
            className={streak.atRisk ? "text-warning" : "text-accent"}
            aria-hidden="true"
          />
          {streak.current} {daysWord(streak.current)}
        </span>
        <span className="inline-flex items-center gap-1" title="Заморозки серии">
          <Snowflake size={14} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
          <span className="tabular-nums">{streak.freezes}</span>
        </span>
      </div>
    </div>
  );
}

export function ActivityBar({
  data,
  streak,
  variant = "A",
}: {
  data: ActivityBarData;
  streak: ActivityStreak;
  variant?: ActivityVariant;
}) {
  return variant === "B" ? (
    <DotsVariant data={data} streak={streak} />
  ) : (
    <LaneVariant data={data} streak={streak} />
  );
}
