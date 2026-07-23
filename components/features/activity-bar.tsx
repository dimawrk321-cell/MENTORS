import { cn } from "@/lib/utils/cn";
import { dateOnlyUtc, formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import type { ActivityBarCell, ActivityBarData } from "@/lib/services/dashboard";

// Activity bar (spec 13.4 block 2): the last 28 days in one row, oldest (left) →
// today (right). Green intensity by the day's XP (empty + 4 steps, theme tokens —
// the same --success/--heat-empty ramp as the retired heatmap). Native title
// tooltip «дата · XP · действия» — no JS. Under the bar: «−27 дней» (left) and
// «сегодня» (right). No month/weekday labels, no legend (spec 13.4 block 2.1).
//
// Layout: cells are flex-1, so all 28 fill the container width — on 390px they are
// simply smaller, never scrolling horizontally. Today carries a thin accent ring.

const LEVEL_OPACITY = [0, 28, 48, 70, 100]; // % of --success by step (matches Heatmap)

/** Cell fill by intensity step (0 = empty tile, 1–4 = green ramp). */
function levelBackground(level: number): string {
  return level === 0
    ? "var(--heat-empty)"
    : `color-mix(in srgb, var(--success) ${LEVEL_OPACITY[level]}%, transparent)`;
}

function cellTitle(cell: ActivityBarCell): string {
  const date = formatDateOnlyRu(dateOnlyUtc(cell.date));
  const actions = `${cell.actions} ${pluralRu(cell.actions, "действие", "действия", "действий")}`;
  return `${date} · ${cell.xp} XP · ${actions}`;
}

export function ActivityBar({ data }: { data: ActivityBarData }) {
  const spanDays = data.days.length - 1; // «−N дней» подпись слева

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-[3px] sm:gap-1">
        {data.days.map((cell) => (
          <div
            key={cell.date}
            title={cellTitle(cell)}
            className={cn(
              "border-border h-9 flex-1 rounded-[4px] border",
              cell.isToday && "ring-accent ring-1 ring-inset",
            )}
            style={{ background: levelBackground(cell.level) }}
          />
        ))}
      </div>
      <div className="text-text-3 flex items-center justify-between text-[11px]">
        <span>−{spanDays} дней</span>
        <span>сегодня</span>
      </div>
    </div>
  );
}
