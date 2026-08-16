import Link from "next/link";
import { Check, HelpCircle } from "lucide-react";
import { GoalRing } from "@/components/features/goal-ring";
import { goalProgress, topUpHints } from "@/lib/utils/xp-explain";
import type { XpMap } from "@/lib/services/xp";

// Дневная цель с числами (заход B.2, блок 1.1).
//
// Раньше здесь было только кольцо с процентом: ученик видел «40%» и не понимал
// ни сколько это в XP, ни чем добрать, ни — главное — засчитан ли день. Два
// механизма разные (spec 7.7), поэтому и говорятся отдельно:
//   • ДЕНЬ СЕРИИ засчитывает любое учебное действие — цель для этого не нужна;
//   • ЦЕЛЬ — отдельная шкала XP за сегодня.
//
// Числа приходят из карты XP (`getXpMap`, app_settings-first) и из
// `daily_goal_xp` ученика; в вёрстке констант нет.

export function DailyGoal({
  todayXp,
  goal,
  dayKey,
  todayCounted,
  xpMap,
}: {
  todayXp: number;
  goal: number;
  dayKey: string;
  /** Из состояния стрика — тот же признак, что рисует серию (spec 7.7). */
  todayCounted: boolean;
  xpMap: XpMap;
}) {
  const progress = goalProgress(todayXp, goal);
  const hints = topUpHints(xpMap);

  return (
    <div className="flex min-w-0 items-center gap-4">
      <GoalRing value={progress.today} goal={progress.goal} dayKey={dayKey} size={88} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[15px] font-semibold">
          <span className="tabular-nums">{progress.today}</span> из{" "}
          <span className="tabular-nums">{progress.goal}</span> XP
        </p>
        {progress.closed ? (
          <p className="text-success flex items-center gap-1.5 text-[13px]">
            <Check size={14} strokeWidth={2.25} aria-hidden="true" />
            Цель на сегодня закрыта
          </p>
        ) : (
          <p className="text-text-2 text-[13px]">
            Осталось <span className="text-text-1 tabular-nums">{progress.remaining}</span> XP
          </p>
        )}
        {/* Главное объяснение: серия не ждёт закрытой цели. */}
        <p className="text-text-3 text-[12px]">
          {todayCounted
            ? "День в серии уже засчитан"
            : "День в серии засчитает любое учебное действие"}
        </p>
        {!progress.closed && hints.length > 0 && (
          <p className="text-text-3 text-[12px]">
            {hints.map((hint, index) => (
              <span key={hint.key}>
                {index > 0 && " · "}
                {hint.label} +{hint.amount}
              </span>
            ))}
          </p>
        )}
        <Link
          href="/profile#xp"
          className="text-text-2 hover:text-accent ease-app inline-flex items-center gap-1 text-[12px] transition-colors duration-150"
        >
          <HelpCircle size={13} strokeWidth={1.75} aria-hidden="true" />
          Как считаются XP и серия
        </Link>
      </div>
    </div>
  );
}
