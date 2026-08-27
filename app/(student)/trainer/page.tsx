import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Dumbbell,
  Flame,
  Info,
  MessageCircleQuestion,
  Play,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  getLaggingCategories,
  getNextReviewDate,
  getSrsQueue,
  getTrainerStats,
  getUpcomingLoad,
  SRS_LEARNED_INTERVAL_DAYS,
  SRS_SESSION_SIZE,
  SRS_STEPS,
  TRAINER_LOAD_DAYS,
  type LaggingCategory,
  type TrainerStats,
  type UpcomingLoadDay,
} from "@/lib/services/srs";
import { getStreakState } from "@/lib/services/streak";
import { formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import { categoryColorVar } from "@/lib/utils/category-color";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/features/icon-tile";

export const metadata: Metadata = { title: "Тренажёр" };

const RING_CIRCUMFERENCE = 2 * Math.PI * 54;
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  timeZone: "UTC",
});

function accuracyTone(accuracy: number | null): string {
  if (accuracy === null) return "text-text-1";
  if (accuracy >= 0.8) return "text-success";
  if (accuracy >= 0.5) return "text-warning";
  return "text-danger";
}

function laggingTone(share: number): { text: string; color: string } {
  return share >= 0.4
    ? { text: "text-danger", color: "var(--danger)" }
    : { text: "text-warning", color: "var(--warning)" };
}

function trendLabel(trend: LaggingCategory["trend"]): string {
  if (trend === "improving") return "стало лучше";
  if (trend === "worsening") return "стало хуже";
  if (trend === "stable") return "без изменений";
  return "новая статистика";
}

function QueueChip({
  dot,
  danger = false,
  children,
}: {
  dot: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="text-text-1 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12px]"
      style={
        danger
          ? {
              borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)",
              background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            }
          : { background: "var(--surface-2)" }
      }
    >
      <span className="size-1.5 rounded-full" style={{ background: dot }} aria-hidden="true" />
      {children}
    </span>
  );
}

function DeckLegend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-[2px]" style={{ background: color }} aria-hidden="true" />
      {children}
    </span>
  );
}

function DeckProgress({ stats }: { stats: TrainerStats }) {
  const total = stats.totalCount;
  const learnedPercent = total === 0 ? 0 : Math.round((stats.learnedCount / total) * 100);
  const segmentWidth = (count: number) => `${total === 0 ? 0 : (count / total) * 100}%`;

  return (
    <Card data-screen-label="Прогресс колоды" className="min-w-0 px-5 py-[18px]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-text-3 text-[13px]">Выучено в колоде</p>
        <p className="text-text-3 text-[13px] tabular-nums">
          {total} {pluralRu(total, "карточка", "карточки", "карточек")}
        </p>
      </div>
      <p className="mt-1 text-[26px] font-bold tracking-[-0.02em] tabular-nums">
        {stats.learnedCount}{" "}
        <span className="text-text-3 text-[15px] font-medium">· {learnedPercent}%</span>
      </p>
      <div
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-[var(--heat-empty)]"
        aria-label={`Выучено ${stats.learnedCount}, в работе ${stats.workingCount}, застряли ${stats.stuckCount}`}
      >
        <span style={{ width: segmentWidth(stats.learnedCount), background: "var(--success)" }} />
        <span
          style={{
            width: segmentWidth(stats.workingCount),
            background: "color-mix(in srgb, var(--accent) 55%, transparent)",
          }}
        />
        <span style={{ width: segmentWidth(stats.stuckCount), background: "var(--danger)" }} />
      </div>
      <div className="text-text-2 mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
        <DeckLegend color="var(--success)">выучено {stats.learnedCount}</DeckLegend>
        <DeckLegend color="color-mix(in srgb, var(--accent) 55%, transparent)">
          в работе {stats.workingCount}
        </DeckLegend>
        <DeckLegend color="var(--danger)">застряли {stats.stuckCount}</DeckLegend>
      </div>
    </Card>
  );
}

function WeeklyAccuracy({ stats }: { stats: TrainerStats }) {
  const current = stats.accuracyByWeek.at(-1)?.accuracy ?? null;
  const previous = stats.accuracyByWeek.at(-2)?.accuracy ?? null;
  const delta =
    current === null || previous === null ? null : Math.round((current - previous) * 100);

  return (
    <Card data-screen-label="Точность по неделям" className="min-w-0 flex-1 px-5 py-[18px]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-text-3 text-[13px]">Точность, 6 недель</p>
        {delta !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[12px]",
              delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-text-3",
            )}
          >
            {delta !== 0 && (
              <ArrowUpRight
                size={13}
                strokeWidth={2}
                className={delta < 0 ? "rotate-90" : undefined}
                aria-hidden="true"
              />
            )}
            {delta > 0 ? "+" : ""}
            {delta} п.п.
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-1 text-[26px] font-bold tracking-[-0.02em] tabular-nums",
          accuracyTone(current),
        )}
      >
        {current === null ? "—" : `${Math.round(current * 100)}%`}
      </p>
      <div
        className="mt-3.5 grid h-[74px] grid-cols-6 items-end gap-2"
        aria-label="Точность по неделям"
      >
        {stats.accuracyByWeek.map((week, index) => {
          const percent = week.accuracy === null ? null : Math.round(week.accuracy * 100);
          return (
            <span
              key={week.weekStart.toISOString()}
              className="block min-h-1 rounded-[5px_5px_2px_2px]"
              style={{
                height: percent === null ? "6%" : `${Math.max(6, percent)}%`,
                background:
                  percent === null
                    ? "var(--heat-empty)"
                    : index === stats.accuracyByWeek.length - 1
                      ? "var(--accent)"
                      : `color-mix(in srgb, var(--accent) ${30 + index * 10}%, transparent)`,
              }}
              title={`${formatDateOnlyRu(week.weekStart)} — ${percent === null ? "нет ответов" : `${percent}%`}`}
            />
          );
        })}
      </div>
      <p className="text-text-3 mt-2 text-[12px]">Доля «Знаю» среди ответов недели</p>
    </Card>
  );
}

function StepFunnel({ stats }: { stats: TrainerStats }) {
  const values = [
    stats.stepDistribution.fresh,
    ...stats.stepDistribution.steps,
    stats.stepDistribution.learned,
  ];
  const labels = ["новые", ...SRS_STEPS.map((days) => `${days} д`), "выучено"];
  const titles = [
    "Новые",
    ...SRS_STEPS.map((days) => `Ступень ${days} ${pluralRu(days, "день", "дня", "дней")}`),
    "Выучено — контроль раз в 90 дней",
  ];
  const max = Math.max(...values, 1);

  return (
    <Card data-screen-label="Воронка ступеней" className="min-w-0 px-[22px] pt-5 pb-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Где стоит колода</h2>
        <p className="text-text-3 text-[12.5px]">
          Каждый верный ответ поднимает карточку на ступень выше
        </p>
      </div>
      <div className="mt-[18px] [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <div className="grid min-w-[600px] grid-cols-7 items-end gap-2.5" aria-label="Ступени SRS">
          {values.map((count, index) => {
            const isFresh = index === 0;
            const isLearned = index === values.length - 1;
            const opacity = Math.min(90, 45 + Math.max(0, index - 1) * 11);
            return (
              <div key={labels[index]} className="flex flex-col items-center gap-2">
                <span
                  className={cn(
                    "text-[13px] font-semibold tabular-nums",
                    isLearned && "text-success",
                  )}
                >
                  {count}
                </span>
                <span
                  className="block w-full rounded-[6px_6px_3px_3px]"
                  style={{
                    height: `${count === 0 ? 4 : Math.max(18, Math.round((count / max) * 112))}px`,
                    background: isFresh
                      ? "var(--violet)"
                      : isLearned
                        ? "var(--success)"
                        : `color-mix(in srgb, var(--accent) ${opacity}%, transparent)`,
                  }}
                  title={`${titles[index]} — ${count} ${pluralRu(count, "карточка", "карточки", "карточек")}`}
                />
                <span
                  className={cn(
                    "text-text-3 text-[11.5px] whitespace-nowrap",
                    isLearned && "text-text-1 font-medium",
                  )}
                >
                  {labels[index]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="border-border text-text-2 mt-4 border-t pt-3.5 text-[12.5px]">
        «Выучено» — карточка прошла все интервалы и возвращается на контроль раз в{" "}
        {SRS_LEARNED_INTERVAL_DAYS} дней. «Не знаю» сбрасывает её в начало лестницы.
      </p>
    </Card>
  );
}

function LaggingTopics({ entries }: { entries: LaggingCategory[] }) {
  return (
    <Card data-screen-label="Западающие темы" className="min-w-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 px-5 pt-[18px] pb-3">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Западающие темы</h2>
        <span className="text-text-3 text-[12px]">30 дней</span>
      </div>
      <ul>
        {entries.map((entry) => {
          const tone = laggingTone(entry.againShare);
          const percent = Math.round(entry.againShare * 100);
          return (
            <li
              key={entry.categoryId}
              className="border-border flex flex-col gap-2 border-t px-5 py-3"
            >
              <div className="flex items-center gap-2.5">
                <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-[13px] font-medium">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: categoryColorVar(entry.colorIndex) }}
                    aria-hidden="true"
                  />
                  <span className="truncate" title={entry.title}>
                    {entry.title}
                  </span>
                </span>
                <span className={cn("text-[14px] font-semibold tabular-nums", tone.text)}>
                  {percent}%
                </span>
              </div>
              <div className="h-[5px] rounded-full bg-[var(--heat-empty)]">
                <span
                  className="block h-[5px] rounded-full"
                  style={{ width: `${percent}%`, background: tone.color }}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-3 min-w-0 truncate text-[12px]">
                  {entry.againCount} «не знаю» из {entry.answers} · {trendLabel(entry.trend)}
                </span>
                <Link
                  href={`/trainer/free/run?source=category&id=${entry.categoryId}&size=15`}
                  className="text-accent hover:text-accent-hover shrink-0 text-[12.5px] font-medium"
                >
                  Потренировать →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function UpcomingLoad({ days, newPerDay }: { days: UpcomingLoadDay[]; newPerDay: number }) {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const average = days.length === 0 ? 0 : Math.round(total / days.length);
  const max = Math.max(...days.map((day) => day.count), 1);

  return (
    <Card data-screen-label="Нагрузка на 14 дней" className="min-w-0 px-[22px] pt-5 pb-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em]">Что придёт на повторение</h2>
        <p className="text-text-3 text-[12.5px]">
          Ближайшие {days.length} дней · в среднем {average}{" "}
          {pluralRu(average, "карточка", "карточки", "карточек")} в день
        </p>
      </div>
      <div className="mt-[18px] [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <div
          className="grid min-w-[760px] grid-cols-14 items-end gap-2"
          aria-label="Нагрузка по дням"
        >
          {days.map((day, index) => {
            const weekday = WEEKDAY_FORMATTER.format(day.date).replace(".", "").slice(0, 2);
            const label = index === 0 ? "сег" : weekday;
            const dateTitle =
              index === 0 ? "Сегодня" : index === 1 ? "Завтра" : formatDateOnlyRu(day.date);
            return (
              <div key={day.date.toISOString()} className="flex flex-col items-center gap-[7px]">
                <span
                  className={cn(
                    "text-[11.5px] tabular-nums",
                    index === 0 ? "text-text-1 font-semibold" : "text-text-3",
                  )}
                >
                  {day.count}
                </span>
                <span
                  className="block w-full rounded-[5px]"
                  style={{
                    height: `${day.count === 0 ? 4 : Math.max(8, Math.round((day.count / max) * 100))}px`,
                    background:
                      index === 0
                        ? "var(--gradient-accent)"
                        : `color-mix(in srgb, var(--accent) ${index < 7 ? 45 : 30}%, transparent)`,
                  }}
                  title={`${dateTitle} — ${day.count} ${pluralRu(day.count, "карточка", "карточки", "карточек")}`}
                />
                <span
                  className={cn(
                    "text-[11px]",
                    index === 0 ? "text-text-1 font-semibold" : "text-text-3",
                  )}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p className="border-border text-text-2 mt-4 border-t pt-3.5 text-[12.5px]">
        Новых карточек в день — не больше {newPerDay}: лишние ждут следующего дня и в план не
        попадают.
      </p>
    </Card>
  );
}

function FooterLink({
  href,
  icon,
  color,
  title,
  description,
}: {
  href: string;
  icon: typeof Dumbbell;
  color: string;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="group block min-w-0">
      <Card interactive className="h-full">
        <div className="flex items-center gap-4 px-5 py-[18px]">
          <IconTile icon={icon} colorVar={color} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">{title}</p>
            <p className="text-text-2 text-[13px]">{description}</p>
          </div>
          <ArrowRight
            size={16}
            strokeWidth={1.75}
            className="text-text-3 group-hover:text-text-1 shrink-0"
            aria-hidden="true"
          />
        </div>
      </Card>
    </Link>
  );
}

/** Хаб тренажёра C.9: реальная очередь, состояние колоды и план повторений. */
export default async function TrainerPage() {
  const { user } = await requireStudentZone();
  const now = new Date();
  const [queue, stats, lagging, upcoming, streak] = await Promise.all([
    getSrsQueue(prisma, { userId: user.id, now }),
    getTrainerStats(prisma, { userId: user.id, now }),
    getLaggingCategories(prisma, { userId: user.id, now }),
    getUpcomingLoad(prisma, { userId: user.id, days: TRAINER_LOAD_DAYS, now }),
    getStreakState(prisma, {
      userId: user.id,
      now,
      timezone: user.timezone,
      studyDays: user.studyDays,
    }),
  ]);
  const nextReview =
    queue.total === 0 ? await getNextReviewDate(prisma, { userId: user.id, now }) : null;
  const plannedToday = queue.answeredToday + queue.total;
  const ringProgress = plannedToday === 0 ? 1 : queue.answeredToday / plannedToday;
  const ringStyle = {
    strokeDasharray: RING_CIRCUMFERENCE,
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - ringProgress),
  } satisfies CSSProperties;
  const hasLagging = lagging !== null && lagging.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div data-screen-label="Заголовок" className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em]">Тренажёр</h1>
          <p className="text-text-2 mt-1.5 text-[14px]">
            Ключевые вопросы возвращаются по расписанию 1 → 3 → 7 → 16 → 35 дней
          </p>
        </div>
        <span className="border-border bg-surface-1 text-text-2 inline-flex items-center gap-2 rounded-full border px-3 py-[5px] text-[13px]">
          <Flame size={15} strokeWidth={1.75} className="text-warning" aria-hidden="true" />
          Серия{" "}
          <strong className="text-text-1 font-semibold tabular-nums">
            {streak.current} {pluralRu(streak.current, "день", "дня", "дней")}
          </strong>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-stretch gap-4 max-[1080px]:grid-cols-1">
        {queue.total > 0 ? (
          <Card
            data-screen-label="Очередь на сегодня"
            aria-label="Очередь на сегодня"
            className="border-border-strong relative flex min-w-0 flex-col overflow-hidden"
          >
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(420px 200px at 88% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 72%)",
              }}
              aria-hidden="true"
            />
            <div className="relative flex flex-1 flex-wrap items-center gap-7 p-6 max-sm:justify-center max-sm:text-center">
              <div
                className="relative size-[132px] shrink-0"
                role="progressbar"
                aria-label="Прогресс очереди на сегодня"
                aria-valuemin={0}
                aria-valuemax={plannedToday}
                aria-valuenow={queue.answeredToday}
              >
                <svg
                  viewBox="0 0 132 132"
                  className="block size-[132px] -rotate-90"
                  aria-hidden="true"
                >
                  <circle
                    cx="66"
                    cy="66"
                    r="54"
                    fill="none"
                    stroke="var(--heat-empty)"
                    strokeWidth="12"
                  />
                  <circle
                    cx="66"
                    cy="66"
                    r="54"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="12"
                    strokeLinecap="round"
                    style={ringStyle}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                  <span className="text-[30px] leading-none font-bold tracking-[-0.02em] tabular-nums">
                    {queue.total}
                  </span>
                  <span className="text-text-3 text-[12px]">осталось</span>
                </div>
              </div>
              <div className="flex min-w-[200px] flex-1 flex-col gap-3.5 max-sm:items-center">
                <div>
                  <p className="text-text-3 text-[13px] tracking-[0.02em] uppercase">
                    Очередь на сегодня
                  </p>
                  <p className="mt-1 text-[20px] font-semibold tracking-[-0.01em]">
                    {queue.total} {pluralRu(queue.total, "карточка", "карточки", "карточек")} · ~
                    {queue.estimateMinutes} мин
                  </p>
                  <p className="text-text-2 mt-1 text-[13px]">
                    {queue.answeredToday} из {plannedToday} уже отвечено
                    {streak.todayCounted ? " — день засчитан" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 max-sm:justify-center">
                  <QueueChip dot="var(--danger)" danger>
                    {queue.breakdown.overdue}{" "}
                    {pluralRu(queue.breakdown.overdue, "просрочена", "просрочены", "просрочены")}
                  </QueueChip>
                  <QueueChip dot="var(--accent)">
                    {queue.breakdown.review}{" "}
                    {pluralRu(queue.breakdown.review, "повтор", "повтора", "повторов")}
                  </QueueChip>
                  <QueueChip dot="var(--violet)">
                    {queue.breakdown.fresh}{" "}
                    {pluralRu(queue.breakdown.fresh, "новая", "новые", "новых")}
                  </QueueChip>
                </div>
                <div className="flex flex-wrap gap-2.5 max-sm:justify-center">
                  <Button asChild variant="gradient" className="h-[42px] px-[22px] font-semibold">
                    <Link href="/trainer/session">
                      <Play size={15} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                      Начать повторения
                    </Link>
                  </Button>
                  <Button asChild variant="secondary" className="h-[42px] px-4">
                    <Link href="/trainer/free">
                      <Dumbbell size={15} strokeWidth={1.75} aria-hidden="true" />
                      Свободная тренировка
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
            <div
              className="border-border text-text-2 relative mt-auto flex items-start gap-2.5 border-t px-6 py-3 text-[12.5px]"
              style={{ background: "color-mix(in srgb, var(--surface-2) 55%, transparent)" }}
            >
              <Info
                size={15}
                strokeWidth={1.75}
                className="text-text-3 mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <p>
                Порция — {SRS_SESSION_SIZE} карточек. Ответил «Знаю» — карточка уйдёт на следующий
                интервал, «Не знаю» — вернётся завтра с первой ступени.
              </p>
            </div>
          </Card>
        ) : (
          <Card
            data-screen-label="Очередь пуста"
            aria-label="Очередь на сегодня"
            className="flex min-w-0 flex-col items-center justify-center gap-3 px-6 py-11 text-center"
          >
            <span
              className="flex size-[52px] items-center justify-center rounded-[14px]"
              style={{ background: "color-mix(in srgb, var(--success) 14%, transparent)" }}
            >
              <Check size={26} strokeWidth={1.75} className="text-success" aria-hidden="true" />
            </span>
            <p className="text-[19px] font-semibold">Всё повторено</p>
            <p className="text-text-2 max-w-[34ch] text-[14px]">
              {nextReview
                ? `Следующие карточки — ${formatDateOnlyRu(nextReview)}. Хочешь ещё сегодня — прогони свободную тренировку: она не тратит очередь.`
                : "Новых карточек пока нет. Хочешь потренироваться — выбери набор: свободная тренировка не тратит очередь."}
            </p>
            <Button asChild variant="secondary" className="mt-1 h-10 px-[18px]">
              <Link href="/trainer/free">Свободная тренировка</Link>
            </Button>
          </Card>
        )}

        <div className="flex min-w-0 flex-col gap-4">
          <DeckProgress stats={stats} />
          <WeeklyAccuracy stats={stats} />
        </div>
      </div>

      <div
        className={cn(
          "grid items-start gap-4",
          hasLagging
            ? "grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] max-[1080px]:grid-cols-1"
            : "grid-cols-1",
        )}
      >
        <StepFunnel stats={stats} />
        {hasLagging && <LaggingTopics entries={lagging} />}
      </div>

      <UpcomingLoad days={upcoming} newPerDay={queue.newPerDay} />

      <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-4 max-[1080px]:grid-cols-1">
        <FooterLink
          href="/questions"
          icon={MessageCircleQuestion}
          color="var(--cat-0)"
          title="Каталог вопросов"
          description="Весь банк с фильтрами — любой вопрос можно добавить в повторения."
        />
        <FooterLink
          href="/trainer/free"
          icon={Dumbbell}
          color="var(--violet)"
          title="Свободная тренировка"
          description="Прогон по набору — без XP и без расхода очереди."
        />
      </div>
    </div>
  );
}
