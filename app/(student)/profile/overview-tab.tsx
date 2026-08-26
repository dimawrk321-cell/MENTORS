import Link from "next/link";
import { BookOpen, Flame, Layers, Video, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AchievementIcon } from "@/components/features/achievement-icon";
import { Heatmap } from "@/components/features/heatmap";
import { ProgressRing } from "@/components/features/progress-ring";
import { categoryColorVar } from "@/lib/utils/category-color";
import { pluralRu } from "@/lib/utils/dates";
import { accuracyColorVar, heatmapActiveDays, lessonTotals } from "@/lib/utils/profile-overview";
import type { HeatmapData } from "@/lib/services/dashboard";
import type { UserAchievementsSummary } from "@/lib/services/achievements";
import type { LaggingCategory } from "@/lib/services/srs";
import type { TrainerStats } from "@/lib/services/srs";
import type { StreakState } from "@/lib/services/streak";

// Вкладка «Обзор» (референс «Профиль v2»): показатели → прогресс и темы →
// активность → достижения.
//
// Здесь ничего не выдумывается: каждое число приходит из того же сервиса, что
// рисует его на своём экране (курсы — `listCoursesForStudent`, карточки —
// `getTrainerStats`, темы — `getLaggingCategories`, сетка — `getHeatmapData`).
// Где данных нет, стоит честная пустая строка, а не прочерк-заглушка.

interface CourseRow {
  id: string;
  title: string;
  progressPct: number;
  lessonsCompleted: number;
  lessonsTotal: number;
  locked: boolean;
}

export function OverviewTab({
  streak,
  courses,
  lessonsLastWeek,
  cards,
  mocks,
  lagging,
  heatmap,
  achievements,
}: {
  streak: StreakState;
  courses: CourseRow[];
  lessonsLastWeek: number;
  cards: TrainerStats;
  mocks: { completed: number; average: number | null };
  lagging: LaggingCategory[] | null;
  heatmap: HeatmapData;
  achievements: UserAchievementsSummary;
}) {
  const lessons = lessonTotals(courses);
  const activeDays = heatmapActiveDays(heatmap);
  const weeks = heatmap.columns.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Показатели */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Flame}
          colorVar="var(--warning)"
          label="Серия"
          value={`${streak.current} ${pluralRu(streak.current, "день", "дня", "дней")}`}
          note={
            <>
              Лучшая — {streak.best} {pluralRu(streak.best, "день", "дня", "дней")}
              <Dot />
              <Link href="/profile?tab=xp" className="text-accent font-medium">
                как считается
              </Link>
            </>
          }
        />
        <StatCard
          icon={BookOpen}
          colorVar="var(--cat-1)"
          label="Уроки"
          value={
            <>
              {lessons.completed}
              <span className="text-text-3 text-[16px] font-medium"> / {lessons.total}</span>
            </>
          }
          note={
            lessonsLastWeek > 0
              ? `+${lessonsLastWeek} за последнюю неделю`
              : "за последнюю неделю — ни одного"
          }
        />
        <StatCard
          icon={Layers}
          colorVar="var(--cat-0)"
          label="Карточки"
          value={String(cards.learnedCount)}
          note={
            cards.accuracy30 === null
              ? `Отвечено всего — ${cards.answeredTotal}`
              : `Точность за 30 дней ${Math.round(cards.accuracy30 * 100)}%`
          }
        />
        <StatCard
          icon={Video}
          colorVar="var(--cat-7)"
          label="Моки"
          value={String(mocks.completed)}
          note={
            mocks.average === null
              ? "Оценок пока нет"
              : `Средняя оценка ${mocks.average.toFixed(1).replace(".", ",")} из 5`
          }
        />
      </section>

      {/* Прогресс по программе + западающие темы */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[16px] font-semibold tracking-[-0.012em]">Прогресс по курсам</h2>
              <Link href="/courses" className="text-accent shrink-0 text-[13px] font-medium">
                Открыть обучение →
              </Link>
            </div>
            {lessons.total === 0 ? (
              <p className="text-text-2 text-[14px]">
                В программе пока нет обязательных уроков — считать нечего.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-5">
                <ProgressRing
                  pct={lessons.pct}
                  colorVar="var(--accent)"
                  size={96}
                  stroke={9}
                  label={`Пройдено ${lessons.pct}% программы`}
                />
                <ul className="flex min-w-0 flex-[1_1_220px] flex-col gap-2.5">
                  {courses.map((course) => (
                    <li key={course.id} className="flex items-center gap-3">
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] ${
                          course.locked ? "text-text-3" : "text-text-2"
                        }`}
                        title={`${course.title} — ${course.lessonsCompleted} из ${course.lessonsTotal}`}
                      >
                        {course.title}
                      </span>
                      <Bar pct={course.progressPct} colorVar="var(--accent)" />
                      <span className="text-text-3 w-9 shrink-0 text-right text-[12px] font-semibold tabular-nums">
                        {course.progressPct}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3">
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.012em]">Западающие темы</h2>
              <p className="text-text-3 text-[13px]">По ответам в тренажёре за 30 дней</p>
            </div>
            {lagging === null || lagging.length === 0 ? (
              <p className="text-text-2 text-[14px]">
                Блок появится, когда наберётся 20 ответов за 30 дней.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {lagging.map((topic) => {
                  const accuracy = Math.round((1 - topic.againShare) * 100);
                  return (
                    <li key={topic.categoryId} className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: categoryColorVar(topic.colorIndex) }}
                      />
                      <span
                        className="text-text-2 min-w-0 flex-1 truncate text-[13px]"
                        title={`${topic.title} — ${topic.answers} ${pluralRu(topic.answers, "ответ", "ответа", "ответов")}`}
                      >
                        {topic.title}
                      </span>
                      <Bar pct={accuracy} colorVar={accuracyColorVar(accuracy)} />
                      <span
                        className="w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums"
                        style={{ color: accuracyColorVar(accuracy) }}
                      >
                        {accuracy}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Активность */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[16px] font-semibold tracking-[-0.012em]">Активность</h2>
            <span className="text-text-3 text-[13px]">
              {activeDays} {pluralRu(activeDays, "активный день", "активных дня", "активных дней")}{" "}
              за {weeks} {pluralRu(weeks, "неделю", "недели", "недель")}
            </span>
          </div>
          <Heatmap data={heatmap} />
        </CardContent>
      </Card>

      {/* Достижения */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[16px] font-semibold tracking-[-0.012em]">Достижения</h2>
            <span className="text-text-3 text-[13px]">
              {achievements.count} из {achievements.visibleTotal} получено
            </span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {achievements.earned.map((achievement) => (
              <div
                key={achievement.key}
                className="rounded-control border-border bg-surface-2/40 flex items-center gap-3 border p-3"
              >
                <AchievementIcon name={achievement.icon} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium">
                    {achievement.title}
                  </span>
                  <span className="text-text-3 block text-[12px]">{achievement.description}</span>
                </span>
              </div>
            ))}
            {achievements.locked.map((achievement) => (
              <div
                key={achievement.key}
                className="rounded-control border-border flex items-center gap-3 border border-dashed p-3 opacity-60"
              >
                <AchievementIcon name={achievement.icon} muted />
                <span className="min-w-0">
                  <span className="text-text-2 block truncate text-[14px] font-medium">
                    {achievement.title}
                  </span>
                  <span className="text-text-3 block text-[12px]">{achievement.description}</span>
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  colorVar,
  label,
  value,
  note,
}: {
  icon: LucideIcon;
  colorVar: string;
  label: string;
  value: React.ReactNode;
  note: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-text-3 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.07em] uppercase">
          <Icon size={13} strokeWidth={1.9} style={{ color: colorVar }} aria-hidden="true" />
          {label}
        </span>
        <span className="text-[26px] leading-[1.15] font-bold tracking-[-0.03em] tabular-nums">
          {value}
        </span>
        <span className="text-text-3 flex flex-wrap items-center gap-1.5 text-[12px]">{note}</span>
      </CardContent>
    </Card>
  );
}

function Bar({ pct, colorVar }: { pct: number; colorVar: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span aria-hidden="true" className="bg-surface-2 h-1.5 w-20 overflow-hidden rounded-full">
      <span
        className="block h-full rounded-full"
        style={{ width: `${clamped}%`, background: colorVar }}
      />
    </span>
  );
}

function Dot() {
  return <span aria-hidden="true" className="bg-text-3 size-[3px] rounded-full" />;
}
