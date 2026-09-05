import Link from "next/link";
import { ArrowUpRight, Brain, ChevronRight, Clock3, Layers3, type LucideIcon } from "lucide-react";
import { StudySessionExplainer } from "@/components/features/study-session-explainer";
import { StudySessionTimer } from "@/components/features/study-session-timer";
import { Card, CardContent } from "@/components/ui/card";
import {
  elapsedMinutes,
  explainLabels,
  summarizeStudyWeek,
  type StudyCard,
} from "@/lib/utils/study-session-summary";

type WeekSummary = Pick<
  ReturnType<typeof summarizeStudyWeek>,
  "count" | "totalMinutes" | "averageMinutes" | "explain"
>;

export function StudySessionDashboard({
  active,
  summary,
  recent,
}: {
  active: StudyCard | null;
  summary: WeekSummary;
  recent: StudyCard[];
}) {
  const activeHref = active?.lessonId
    ? `/lessons/${active.lessonId}#study-session-${active.id}`
    : `/study-sessions${active ? `#study-session-${active.id}` : ""}`;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Карточки занятий</h2>
        <Link href="/study-sessions" className="text-text-2 hover:text-accent text-[13px]">
          Все карточки →
        </Link>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4 p-[18px]">
          <StudySessionExplainer compact />

          {active ? (
            <div className="border-accent/30 bg-accent/6 rounded-control flex flex-wrap items-center gap-3 border p-3.5">
              <span className="bg-accent/12 text-accent flex size-10 shrink-0 items-center justify-center rounded-full">
                <Clock3 size={18} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-[12rem] flex-1">
                <p className="text-text-3 text-[12px]">
                  {active.status === "running"
                    ? "Сейчас идёт занятие"
                    : active.status === "reflection"
                      ? "Осталась короткая рефлексия"
                      : "План ещё не запущен"}
                </p>
                <p className="truncate text-[15px] font-semibold">
                  {active.fields.topic || active.lessonTitle || "Учебная сессия"}
                </p>
              </div>
              {active.status === "running" && active.startedAt && (
                <StudySessionTimer
                  startedAt={active.startedAt}
                  plannedBlocks={active.fields.plannedBlocks}
                  blockMinutes={active.fields.blockMinutes}
                />
              )}
              <Link
                href={activeHref}
                className="text-accent hover:text-accent-hover inline-flex min-h-11 items-center gap-1 text-[13px] font-medium"
              >
                Открыть
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
          ) : recent.length === 0 ? (
            <Link
              href="/study-sessions"
              className="border-border hover:border-accent/40 rounded-control flex min-h-11 items-center justify-between gap-3 border px-3.5 py-3 text-[14px] transition-colors"
            >
              <span>Создать первую карточку занятия</span>
              <ChevronRight size={17} className="text-text-3" aria-hidden="true" />
            </Link>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <WeekMetric icon={Layers3} value={summary.count} label="занятий" />
            <WeekMetric icon={Clock3} value={`${summary.totalMinutes} мин`} label="за неделю" />
            <WeekMetric icon={Brain} value={summary.explain.yes} label="могу объяснить" />
          </div>

          {recent.length > 0 && (
            <div className="border-border border-t pt-4">
              <p className="mb-2.5 text-[13px] font-medium">Последние занятия</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {recent.map((card) => {
                  const minutes = elapsedMinutes(card);
                  return (
                    <Link
                      key={card.id}
                      href={`/study-sessions#study-session-${card.id}`}
                      className="bg-surface-2 border-border hover:border-accent/40 rounded-control group min-w-0 border p-3 transition-colors"
                    >
                      <p className="truncate text-[13px] font-medium">
                        {card.fields.topic || card.lessonTitle || "Без темы"}
                      </p>
                      <p className="text-text-3 mt-1 text-[12px]">
                        {formatShortDate(card.endedAt ?? card.createdAt, card.timezone)}
                        {minutes !== null ? ` · ${minutes} мин` : ""}
                      </p>
                      <p className="text-text-2 group-hover:text-text-1 mt-2 truncate text-[12px]">
                        {card.fields.explain
                          ? `Объясню: ${explainLabels[card.fields.explain].toLocaleLowerCase("ru")}`
                          : "Открыть карточку"}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function WeekMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string | number;
  label: string;
}) {
  return (
    <div className="bg-surface-2 rounded-control min-w-0 p-3">
      <Icon size={15} className="text-accent mb-1.5" strokeWidth={1.75} aria-hidden="true" />
      <p className="truncate text-[17px] font-semibold tabular-nums">{value}</p>
      <p className="text-text-3 truncate text-[11px]">{label}</p>
    </div>
  );
}

function formatShortDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  })
    .format(new Date(value))
    .replace(".", "");
}
