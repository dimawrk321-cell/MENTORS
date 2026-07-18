import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireAdminZone } from "@/lib/auth/guards";
import { getSegmentCourses } from "@/lib/services/announcements";
import {
  getActivityBars,
  getCourseFunnel,
  getGuides,
  getLagging,
  getMocks,
  getTopFailed,
  ANALYTICS_PERIODS,
  type AnalyticsPeriod,
} from "@/lib/services/admin-analytics";
import { emitEvent } from "@/lib/services/events";
import { MOCK_VERDICT_LABEL } from "@/lib/constants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartEmpty, HBarRow, StatTile } from "@/components/features/analytics-charts";
import { WidgetBoundary, WidgetSkeleton } from "@/components/features/widget-boundary";
import { CourseSelect, PeriodTabs } from "./analytics-controls";

export const metadata: Metadata = { title: "Аналитика" };

function formatHours(h: number | null): string {
  if (h === null) return "—";
  if (h < 24) return `~${Math.round(h)} ч`;
  return `~${Math.round(h / 24)} дн`;
}

/** Wraps a widget body in its own error boundary + suspense (spec 12.1/A1). */
function Widget({ rows, children }: { rows?: number; children: React.ReactNode }) {
  return (
    <WidgetBoundary>
      <Suspense fallback={<WidgetSkeleton rows={rows} />}>{children}</Suspense>
    </WidgetBoundary>
  );
}

// --- Per-widget async server components (each fails/suspends independently) ---

async function FunnelBody({ courseId }: { courseId: string | undefined }) {
  const funnel = courseId ? await getCourseFunnel(courseId) : null;
  if (!funnel || funnel.steps.length === 0) return <ChartEmpty>Нет уроков в курсе.</ChartEmpty>;
  if (funnel.started === 0) return <ChartEmpty>Курс ещё никто не начал.</ChartEmpty>;
  return (
    <>
      <p className="text-text-3 text-[13px]">Начали курс: {funnel.started}</p>
      {funnel.steps.map((s) => (
        <HBarRow
          key={s.lessonId}
          label={s.title}
          pct={s.pct}
          valueText={`${s.reached} · ${s.pct}%`}
        />
      ))}
    </>
  );
}

async function TopFailedBody() {
  const topFailed = await getTopFailed();
  if (topFailed.length === 0) return <ChartEmpty>Пока мало ответов для статистики.</ChartEmpty>;
  return (
    <>
      {topFailed.map((q) => (
        <HBarRow
          key={q.id}
          label={q.text}
          href={`/admin/questions/${q.id}`}
          pct={q.failRate * 100}
          tone="danger"
          valueText={`${Math.round(q.failRate * 100)}% · ${q.total}`}
        />
      ))}
    </>
  );
}

async function LaggingBody({ period }: { period: number }) {
  const lagging = await getLagging(period);
  if (lagging.length === 0) return <ChartEmpty>Пока мало повторений для статистики.</ChartEmpty>;
  return (
    <>
      {lagging.map((c) => (
        <HBarRow
          key={c.id}
          label={c.title}
          pct={c.againRate * 100}
          tone="warning"
          valueText={`${Math.round(c.againRate * 100)}% · ${c.total}`}
        />
      ))}
    </>
  );
}

async function ActivityBody() {
  const activity = await getActivityBars();
  if (activity.every((p) => p.active === 0)) return <ChartEmpty>Пока нет активности.</ChartEmpty>;
  const max = Math.max(1, ...activity.map((p) => p.active));
  return (
    <>
      {activity.map((p) => (
        <HBarRow
          key={p.key}
          label={`неделя ${p.label}`}
          pct={(p.active / max) * 100}
          valueText={String(p.active)}
        />
      ))}
    </>
  );
}

async function MocksBody({ period }: { period: number }) {
  const mocks = await getMocks(period);
  const verdictTotal = mocks.verdicts.ready + mocks.verdicts.needs_work + mocks.verdicts.not_ready;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Проведено" value={String(mocks.completed)} />
        <StatTile label="Опубликовано фидбеков" value={String(verdictTotal)} />
        <StatTile label="Среднее время до фидбека" value={formatHours(mocks.avgHoursToFeedback)} />
      </div>
      {verdictTotal === 0 ? (
        <ChartEmpty>Пока нет опубликованных фидбеков.</ChartEmpty>
      ) : (
        <div className="flex flex-col gap-2.5">
          {(["ready", "needs_work", "not_ready"] as const).map((v) => (
            <HBarRow
              key={v}
              label={MOCK_VERDICT_LABEL[v] ?? v}
              pct={(mocks.verdicts[v] / verdictTotal) * 100}
              tone={v === "ready" ? "success" : v === "needs_work" ? "warning" : "danger"}
              valueText={String(mocks.verdicts[v])}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** One guide stat row — title links to its editor (spec 12.1/A2). */
function GuideStatRow({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <a
        href={`/admin/content/guides/${id}`}
        className="ease-app hover:text-text-1 min-w-0 truncate"
        title={title}
      >
        {title}
      </a>
      <span className="text-text-2 shrink-0 tabular-nums">{count}</span>
    </div>
  );
}

async function GuidesMostReadBody() {
  const guides = await getGuides();
  if (guides.mostRead.length === 0) return <ChartEmpty>Пока нет открытий гайдов.</ChartEmpty>;
  return (
    <>
      {guides.mostRead.map((g) => (
        <GuideStatRow key={g.id} id={g.id} title={g.title} count={g.count} />
      ))}
    </>
  );
}

async function GuidesBookmarkedBody() {
  const guides = await getGuides();
  if (guides.topBookmarked.length === 0) return <ChartEmpty>Пока нет закладок.</ChartEmpty>;
  return (
    <>
      {guides.topBookmarked.map((g) => (
        <GuideStatRow key={g.id} id={g.id} title={g.title} count={g.count} />
      ))}
    </>
  );
}

interface PageProps {
  searchParams: Promise<{ course?: string; period?: string }>;
}

// /admin/analytics (spec 8.5/7.13): funnel, top-failed questions, lagging
// categories, activity, mocks, guides. SQL aggregates cached 10 min. mentor+.
// A1 (spec 12.1): every widget renders in its own Suspense + error boundary so one
// failing/slow aggregate never blanks the page or gets the period tabs stuck.
export default async function AnalyticsPage({ searchParams }: PageProps) {
  const { user } = await requireAdminZone();
  const sp = await searchParams;

  const courses = await getSegmentCourses(prisma);
  const courseId =
    sp.course && courses.some((c) => c.id === sp.course) ? sp.course : courses[0]?.id;
  const period: AnalyticsPeriod = ANALYTICS_PERIODS.includes(Number(sp.period) as AnalyticsPeriod)
    ? (Number(sp.period) as AnalyticsPeriod)
    : 30;

  // analytics.viewed (spec 7.13 «События») — без деталей.
  await emitEvent(prisma, "analytics.viewed", {}, { userId: user.id });

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
              {courses.length === 0 ? "Нет опубликованных курсов" : "Доля дошедших до урока"}
            </CardDescription>
          </div>
          {courseId && <CourseSelect courses={courses} courseId={courseId} />}
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          <Widget rows={5}>
            <FunnelBody courseId={courseId} />
          </Widget>
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
            <Widget>
              <TopFailedBody />
            </Widget>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Западающие категории</CardTitle>
            <CardDescription>Доля «не знаю» в повторениях за {period} дней</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <Widget>
              <LaggingBody period={period} />
            </Widget>
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
          <Widget rows={8}>
            <ActivityBody />
          </Widget>
        </CardContent>
      </Card>

      {/* Моки */}
      <Card>
        <CardHeader>
          <CardTitle>Моки</CardTitle>
          <CardDescription>За {period} дней</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Widget rows={3}>
            <MocksBody period={period} />
          </Widget>
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
            <Widget rows={5}>
              <GuidesMostReadBody />
            </Widget>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Топ закладок</CardTitle>
            <CardDescription>Сколько учеников добавили в закладки</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            <Widget rows={5}>
              <GuidesBookmarkedBody />
            </Widget>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
