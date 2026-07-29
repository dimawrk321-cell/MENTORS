import { Flame, Snowflake } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { pluralRu } from "@/lib/utils/dates";

// StreakBadge (spec 5.3/8.3): число дней серии. Состояние «под угрозой» (после
// 20:00, день не засчитан, серия ≥3) — warning-цвет. Заморозки — снежинки.
interface StreakBadgeProps {
  current: number;
  atRisk: boolean;
  freezes: number;
}

export function StreakBadge({ current, atRisk, freezes }: StreakBadgeProps) {
  return (
    <span
      title={atRisk ? "Серия под угрозой — позанимайся сегодня" : undefined}
      className={cn(
        "rounded-pill inline-flex items-center gap-1.5 border px-3 py-[5px] text-[13px] font-medium",
        // Design handoff: non-atRisk is accent-tinted with an accent flame; atRisk stays warning.
        atRisk
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-accent/30 bg-accent/10 text-text-1",
      )}
    >
      <Flame
        size={15}
        strokeWidth={1.75}
        className={atRisk ? "text-warning" : "text-accent"}
        aria-hidden="true"
      />
      {current} {pluralRu(current, "день", "дня", "дней")} подряд
      {freezes > 0 && (
        <span
          className="text-text-3 ml-0.5 inline-flex items-center gap-0.5"
          title={`Заморозок: ${freezes}`}
        >
          <Snowflake size={13} strokeWidth={1.75} aria-hidden="true" />
          {freezes}
        </span>
      )}
    </span>
  );
}
