import Link from "next/link";
import { Flame, Snowflake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DailyGoal } from "@/components/features/daily-goal";
import { XpExplainer } from "@/components/features/xp-explainer";
import { pluralRu } from "@/lib/utils/dates";
import type { StreakState } from "@/lib/services/streak";
import type { XpMap, XpSummary } from "@/lib/services/xp";

export function XpTab({
  streak,
  xp,
  todayXp,
  goal,
  dayKey,
  xpMap,
  levelTitle,
}: {
  streak: StreakState;
  xp: XpSummary;
  todayXp: number;
  goal: number;
  dayKey: string;
  xpMap: XpMap;
  levelTitle: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-2 max-w-3xl text-[14px]">
        Серия, дневная цель и XP — разные показатели. Значения ниже берутся из настроек платформы и
        твоей активности.
      </p>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold">Серия</h2>
              <span className="text-warning inline-flex items-center gap-1.5 text-[13px] font-medium">
                <Flame size={15} strokeWidth={1.8} aria-hidden="true" />
                {streak.current} {pluralRu(streak.current, "день", "дня", "дней")}
              </span>
            </div>
            <p className="text-text-2 text-[14px]">
              Лучший результат — {streak.best} {pluralRu(streak.best, "день", "дня", "дней")}. День
              уже {streak.todayCounted ? "засчитан" : "не засчитан"}.
            </p>
            <div className="border-border mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[13px]">
              <span className="text-text-2 inline-flex items-center gap-1.5">
                <Snowflake size={15} strokeWidth={1.75} aria-hidden="true" />
                Заморозки: {streak.freezes}
              </span>
              <span className="text-text-3">Считаются только учебные дни</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="mb-3 text-[16px] font-semibold">Дневная цель</h2>
            <DailyGoal
              todayXp={todayXp}
              goal={goal}
              dayKey={dayKey}
              todayCounted={streak.todayCounted}
              xpMap={xpMap}
            />
          </CardContent>
        </Card>
      </section>

      <XpExplainer xpMap={xpMap} goal={goal} />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-[14px] text-[18px] font-bold text-white"
            style={{ backgroundImage: "var(--gradient-accent)" }}
          >
            {xp.level.level}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">
              Уровень {xp.level.level}
              {levelTitle ? ` — «${levelTitle}»` : ""}
            </h2>
            <p className="text-text-2 text-[13px]">
              Накоплено {xp.totalXp} XP. До следующего уровня — {xp.level.toNext} XP.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/trainer/session">Закрыть очередь повторений</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
