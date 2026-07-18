import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAdminZone } from "@/lib/auth/guards";
import { getSegmentCourses } from "@/lib/services/announcements";
import {
  getAnalyticsBundle,
  getCourseFunnel,
  ANALYTICS_PERIODS,
  type AnalyticsPeriod,
} from "@/lib/services/admin-analytics";
import { emitEvent } from "@/lib/services/events";
import { MOCK_VERDICT_LABEL } from "@/lib/constants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartEmpty, HBarRow, StatTile } from "@/components/features/analytics-charts";
import { CourseSelect, PeriodTabs } from "./analytics-controls";

export const metadata: Metadata = { title: "Аналитика" };

const weekLabel = (d: Date) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(d);

function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 24) return `~${Math.round(h)} ч`;
  return `~${Math.round(h / 24)} дн`;
}

interface PageProps {
  searchParams: Promise<{ course?: string; period?: string }>;
}

// /admin/analytics (spec 8.5/7.13): funnel, top-failed questions, lagging
// categories, activity, mocks, guides. SQL aggregates cached 10 min. mentor+.
export default async function AnalyticsPage({ searchParams }: PageProps) {
  const { user } = await requireAdminZone();
  const sp = await searchParams;

  const courses = await getSegmentCourses(prisma);
  const courseId =
    sp.course && courses.some((c) => c.id === sp.course) ? sp.course : courses[0]?.id;
  const period: AnalyticsPeriod = ANALYTICS_PERIODS.includes(Number(sp.period) as AnalyticsPeriod)
    ? (Number(sp.period) as AnalyticsPeriod)
    : 30;

  const [funnel, bundle] = await Promise.all([
    courseId ? getCourseFunnel(courseId) : Promise.resolve(null),
    getAnalyticsBundle(period),
  ]);
  // analytics.viewed (spec 7.13 «События») — без деталей.
  await emitEvent(prisma, "analytics.viewed", {}, { userId: user.id });

  const activityMax = Math.max(1, ...bundle.activity.map((p) => p.active));
  const verdictTotal =
    bundle.mocks.verdicts.ready +
    bundle.mocks.verdicts.needs_work +
    bundle.mocks.verdicts.not_ready;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold">Аналитика</h1>
          <p className="text-text-2 mt-1 text-[14px]">
            Агрегаты по событиям · обновление раз в 10 мин
          </p>
        </div>
        <PeriodTabs period={period} />
      </div>

      {/* Воронка курса */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-0">
          <div>
            <CardTitle>Воронка курса</CardTitle>
            <CardDescription>
              {funnel ? `Начали курс: ${funnel.started}` : "Нет опубликованных курсов"}
            </CardDescription>
          </div>
          {courseId && <CourseSelect courses={courses} courseId={courseId} />}
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {!funnel || funnel.steps.length === 0 ? (
            <ChartEmpty>Нет уроков в курсе.</ChartEmpty>
          ) : funnel.started === 0 ? (
            <ChartEmpty>Курс ещё никто не начал.</ChartEmpty>
          ) : (
            funnel.steps.map((s) => (
              <HBarRow
                key={s.lessonId}
                label={s.title}
                pct={s.pct}
                valueText={`${s.reached} · ${s.pct}%`}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Топ проваливаемых вопросов + западающие категории */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Топ проваливаемых вопросов</CardTitle>
            <CardDescription>Доля неверных в тестах и квизах (от 5 попыток)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {bundle.topFailed.length === 0 ? (
              <ChartEmpty>Пока мало ответов для статистики.</ChartEmpty>
            ) : (
              bundle.topFailed.map((q) => (
                <HBarRow
                  key={q.id}
                  label={q.text}
                  href={`/admin/questions/${q.id}`}
                  pct={q.failRate * 100}
                  tone="danger"
                  valueText={`${Math.round(q.failRate * 100)}% · ${q.total}`}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Западающие категории</CardTitle>
            <CardDescription>Доля «не знаю» в повторениях за {period} дней</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {bundle.lagging.length === 0 ? (
              <ChartEmpty>Пока мало повторений для статистики.</ChartEmpty>
            ) : (
              bundle.lagging.map((c) => (
                <HBarRow
                  key={c.id}
                  label={c.title}
                  pct={c.againRate * 100}
                  tone="warning"
                  valueText={`${Math.round(c.againRate * 100)}% · ${c.total}`}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Активность */}
      <Card>
        <CardHeader>
          <CardTitle>Активность по неделям</CardTitle>
          <CardDescription>Активные ученики (WAU) за 8 недель</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {bundle.activity.every((p) => p.active === 0) ? (
            <ChartEmpty>Пока нет активности.</ChartEmpty>
          ) : (
            bundle.activity.map((p) => (
              <HBarRow
                key={p.weekStart.toISOString()}
                label={`неделя ${weekLabel(p.weekStart)}`}
                pct={(p.active / activityMax) * 100}
                valueText={String(p.active)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Моки */}
      <Card>
        <CardHeader>
          <CardTitle>Моки</CardTitle>
          <CardDescription>За {period} дней</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Проведено" value={String(bundle.mocks.completed)} />
            <StatTile label="Опубликовано фидбеков" value={String(verdictTotal)} />
            <StatTile
              label="Среднее время до фидбека"
              value={formatHours(bundle.mocks.avgHoursToFeedback)}
            />
          </div>
          {verdictTotal === 0 ? (
            <ChartEmpty>Пока нет опубликованных фидбеков.</ChartEmpty>
          ) : (
            <div className="flex flex-col gap-2.5">
              {(["ready", "needs_work", "not_ready"] as const).map((v) => (
                <HBarRow
                  key={v}
                  label={MOCK_VERDICT_LABEL[v] ?? v}
                  pct={(bundle.mocks.verdicts[v] / verdictTotal) * 100}
                  tone={v === "ready" ? "success" : v === "needs_work" ? "warning" : "danger"}
                  valueText={String(bundle.mocks.verdicts[v])}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Гайды */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Самые читаемые гайды</CardTitle>
            <CardDescription>Открытия за 30 дней</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {bundle.guides.mostRead.length === 0 ? (
              <ChartEmpty>Пока нет открытий гайдов.</ChartEmpty>
            ) : (
              bundle.guides.mostRead.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{g.title}</span>
                  <span className="text-text-2 shrink-0 tabular-nums">{g.count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Топ закладок</CardTitle>
            <CardDescription>Сколько учеников добавили в закладки</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {bundle.guides.topBookmarked.length === 0 ? (
              <ChartEmpty>Пока нет закладок.</ChartEmpty>
            ) : (
              bundle.guides.topBookmarked.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{g.title}</span>
                  <span className="text-text-2 shrink-0 tabular-nums">{g.count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
