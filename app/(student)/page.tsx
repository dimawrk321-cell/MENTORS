import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { Layers, Play, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getContinueTarget, getHeatmapData } from "@/lib/services/dashboard";
import { getSrsQueue, getNextReviewDate, getLaggingCategories } from "@/lib/services/srs";
import { listCoursesForStudent } from "@/lib/services/content";
import { getStreakState, processStreakDay } from "@/lib/services/streak";
import { getTodayXp, getXpSummary } from "@/lib/services/xp";
import { formatDateOnlyRu, localDateStr, pluralRu } from "@/lib/utils/dates";
import { categoryColorVar } from "@/lib/utils/category-color";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { GoalRing } from "@/components/features/goal-ring";
import { StreakBadge } from "@/components/features/streak-badge";
import { LevelBadge } from "@/components/features/level-badge";
import { Heatmap } from "@/components/features/heatmap";

export const metadata: Metadata = {
  title: "Главная",
};

const HEATMAP_WEEKS = 26; // desktop; мобильный показывает последние 12 (spec 5.3)

/** Heatmap кешируется 60с на пользователя в сутки (spec 12: агрегаты дашборда). */
function loadHeatmap(userId: string, timezone: string, todayStr: string) {
  return unstable_cache(
    () => getHeatmapData(prisma, { userId, now: new Date(), timezone, weeks: HEATMAP_WEEKS }),
    ["dashboard-heatmap", userId, todayStr],
    { revalidate: 60 },
  )();
}

/** Дашборд (spec 8.3): стрик/цель → продолжить → очередь → мок → курсы. */
export default async function DashboardPage() {
  const { user } = await requireStudentZone();
  const now = new Date();
  const todayStr = localDateStr(now, user.timezone);

  // Ленивый «конец дня»: разрешаем пропущенные учебные дни до первого чтения серии.
  await processStreakDay(prisma, { userId: user.id, now });

  const [streak, xp, todayXp, cont, queue, courses, lagging, heatmap] = await Promise.all([
    getStreakState(prisma, {
      userId: user.id,
      now,
      timezone: user.timezone,
      studyDays: user.studyDays,
    }),
    getXpSummary(prisma, user.id),
    getTodayXp(prisma, user.id, now, user.timezone),
    getContinueTarget(prisma, user.id, user.track),
    getSrsQueue(prisma, { userId: user.id, now }),
    listCoursesForStudent(prisma, user.id, user.track),
    getLaggingCategories(prisma, { userId: user.id, now }),
    loadHeatmap(user.id, user.timezone, todayStr),
  ]);
  const nextReview =
    queue.total === 0 ? await getNextReviewDate(prisma, { userId: user.id, now }) : null;

  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <div className="flex flex-col gap-6">
      {/* Приветствие + StreakBadge + Level + GoalRing (spec 8.3) */}
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-[24px] font-semibold">Привет, {firstName}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StreakBadge current={streak.current} atRisk={streak.atRisk} freezes={streak.freezes} />
            <LevelBadge
              level={xp.level.level}
              progress={xp.level.progress}
              toNext={xp.level.toNext}
            />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <GoalRing value={todayXp} goal={user.dailyGoalXp} dayKey={todayStr} />
        </div>
      </section>

      {/* Hero «Продолжить» — градиентная кнопка (одно из трёх мест градиента, 5.1) */}
      {cont ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-text-3 text-[13px]">
                {cont.courseTitle} · {cont.moduleTitle}
                {cont.moduleTotal > 0 && ` · ${cont.moduleDone}/${cont.moduleTotal}`}
              </p>
              <p className="text-[18px] font-semibold">{cont.lessonTitle}</p>
            </div>
            <div>
              <Link
                href={`/lessons/${cont.lessonId}`}
                style={{ backgroundImage: "var(--gradient-accent)" }}
                className="rounded-control ease-app inline-flex h-10 items-center gap-2 px-5 text-[14px] font-medium text-white transition-transform duration-150 active:scale-[.98]"
              >
                <Play size={15} strokeWidth={1.75} aria-hidden="true" />
                {cont.mode === "continue" ? "Продолжить" : "Начать обучение"}
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Начни с первого урока"
            description="Здесь появится твой прогресс"
            action={
              <Button asChild>
                <Link href="/courses">Открыть курсы</Link>
              </Button>
            }
          />
        </Card>
      )}

      {/* «Сегодня»: очередь повторений (мок-карточка — этап 6, слот оставлен) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold">Сегодня</h2>
        {queue.total > 0 ? (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="rounded-pill border-border bg-surface-2 flex size-10 shrink-0 items-center justify-center border">
                <Layers size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-text-3 text-[13px]">Очередь повторений</p>
                <p className="text-[16px] font-semibold">
                  {queue.total} {pluralRu(queue.total, "карточка", "карточки", "карточек")} · ~
                  {queue.estimateMinutes} мин
                </p>
              </div>
              <Button asChild>
                <Link href="/trainer/session">
                  <Play size={15} strokeWidth={1.75} aria-hidden="true" />
                  Начать
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={Layers}
              title="Всё повторено"
              description={
                nextReview
                  ? `Следующие карточки — ${formatDateOnlyRu(nextReview)}.`
                  : "Заверши урок — его ключевые вопросы придут сюда."
              }
            />
          </Card>
        )}
        {/* Слот карточки ближайшего мока — появится на этапе 6 (spec 8.3). */}
      </section>

      {/* Прогресс по курсам (spec 8.3): мини-карточки, % по обязательным урокам */}
      {courses.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Курсы</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {courses.map((course) => (
              <Link key={course.id} href={`/courses/${course.slug}`} className="group">
                <Card interactive>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="group-hover:text-accent min-w-0 truncate text-[15px] font-medium">
                        {course.title}
                      </p>
                      <span className="text-text-2 shrink-0 text-[13px]">
                        {course.progressPct}%
                      </span>
                    </div>
                    <ProgressBar
                      value={course.progressPct}
                      aria-label={`Прогресс курса «${course.title}»`}
                    />
                    <p className="text-text-3 text-[12px]">
                      {course.lessonsCompleted} из {course.lessonsTotal}{" "}
                      {pluralRu(course.lessonsTotal, "урок", "урока", "уроков")}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Западающие темы (spec 8.3): скрыт при <20 ответов */}
      {lagging !== null && lagging.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Западающие темы</h2>
          <Card>
            <ul className="divide-border divide-y">
              {lagging.map((entry) => (
                <li key={entry.categoryId} className="flex items-center gap-3 px-5 py-3.5">
                  <Badge
                    style={{
                      color: categoryColorVar(entry.colorIndex),
                      background: `color-mix(in srgb, ${categoryColorVar(entry.colorIndex)} 12%, transparent)`,
                    }}
                  >
                    {entry.title}
                  </Badge>
                  <span className="text-text-2 ml-auto text-[13px]">
                    {Math.round(entry.againShare * 100)}% «не знаю» · {entry.answers}{" "}
                    {pluralRu(entry.answers, "ответ", "ответа", "ответов")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Heatmap активности (spec 5.3/8.3) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold">Активность</h2>
        <Card>
          <CardContent className="p-4">
            <Heatmap data={heatmap} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
