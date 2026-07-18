import { unstable_cache } from "next/cache";
import type { Db } from "@/lib/db";
import { prisma } from "@/lib/db";
import { DAY_MS } from "@/lib/utils/dates";

// Аналитика (spec 8.5/7.13): SQL/Prisma aggregates over analytics_events and
// domain tables, cached 10 min (tag "admin-analytics"). Compute functions take
// (db, now, …) for unit tests; cached wrappers use the prisma singleton.

// ANALYTICS_PERIODS/AnalyticsPeriod live in lib/constants (client-safe) so the
// controls client component doesn't pull this server module (prisma) into its bundle.
export { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@/lib/constants";
export const ANALYTICS_CACHE_TAG = "admin-analytics";

const FUNNEL_MIN = 1;
const TOP_FAILED_MIN_ATTEMPTS = 5;
const TOP_FAILED_LIMIT = 20;
const LAGGING_MIN_REVIEWS = 5;
const ACTIVITY_WEEKS = 8;

// --- Course funnel (spec 7.13) ---

export interface FunnelStep {
  lessonId: string;
  title: string;
  reached: number;
  pct: number;
}

export interface CourseFunnel {
  started: number; // denominator: distinct students with ≥1 progress in the course
  steps: FunnelStep[];
}

export async function computeCourseFunnel(db: Db, courseId: string): Promise<CourseFunnel> {
  const lessons = await db.lesson.findMany({
    where: { module: { courseId } },
    select: { id: true, title: true, order: true, module: { select: { order: true } } },
  });
  lessons.sort((a, b) => a.module.order - b.module.order || a.order - b.order);

  // lesson_progress is unique per (user, lesson) → a per-lesson row count over
  // student rows = distinct students who reached that lesson.
  const grouped = await db.lessonProgress.groupBy({
    by: ["lessonId"],
    where: { lesson: { module: { courseId } }, user: { role: "student" } },
    _count: { userId: true },
  });
  const reachedByLesson = new Map(grouped.map((g) => [g.lessonId, g._count.userId]));

  // Denominator: distinct students who started the course (≥1 progress row).
  // A student with zero progress in this course is NOT counted (spec test).
  const starters = await db.lessonProgress.findMany({
    where: { lesson: { module: { courseId } }, user: { role: "student" } },
    select: { userId: true },
    distinct: ["userId"],
  });
  const started = starters.length;

  const steps: FunnelStep[] = lessons.map((l) => {
    const reached = reachedByLesson.get(l.id) ?? 0;
    return {
      lessonId: l.id,
      title: l.title,
      reached,
      pct: started >= FUNNEL_MIN ? Math.round((reached / started) * 100) : 0,
    };
  });
  return { started, steps };
}

// --- Top-20 failed questions (spec 7.13) ---

export interface FailedQuestion {
  id: string;
  text: string;
  failRate: number; // 0..1
  total: number;
}

export async function computeTopFailedQuestions(
  db: Db,
  opts: { minAttempts?: number; limit?: number } = {},
): Promise<FailedQuestion[]> {
  const minAttempts = opts.minAttempts ?? TOP_FAILED_MIN_ATTEMPTS;
  const limit = opts.limit ?? TOP_FAILED_LIMIT;
  const rows = await db.$queryRaw<{ id: string; text_md: string; wrong: bigint; total: bigint }[]>`
    SELECT q.id, q.text_md,
      sum(CASE WHEN a.correct THEN 0 ELSE 1 END) AS wrong,
      count(*) AS total
    FROM (
      SELECT question_id, correct FROM test_attempt_answers
      UNION ALL
      SELECT question_id, correct FROM quiz_answers
    ) a
    JOIN questions q ON q.id = a.question_id
    GROUP BY q.id, q.text_md
    HAVING count(*) >= ${minAttempts}
    ORDER BY (sum(CASE WHEN a.correct THEN 0 ELSE 1 END)::float / count(*)) DESC, count(*) DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    text: r.text_md,
    total: Number(r.total),
    failRate: Number(r.wrong) / Number(r.total),
  }));
}

// --- Lagging categories (spec 7.13: доля again в srs_reviews за 30 дней) ---

export interface LaggingCategory {
  id: string;
  title: string;
  againRate: number;
  total: number;
}

export async function computeLaggingCategories(
  db: Db,
  now: Date,
  days: number,
): Promise<LaggingCategory[]> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const rows = await db.$queryRaw<{ id: string; title: string; again: bigint; total: bigint }[]>`
    SELECT qc.id, qc.title,
      sum(CASE WHEN r.grade = 'again' THEN 1 ELSE 0 END) AS again,
      count(*) AS total
    FROM srs_reviews r
    JOIN srs_cards c ON c.id = r.card_id
    JOIN questions q ON q.id = c.question_id
    JOIN question_categories qc ON qc.id = q.category_id
    WHERE r.reviewed_at >= ${since}
    GROUP BY qc.id, qc.title
    HAVING count(*) >= ${LAGGING_MIN_REVIEWS}
    ORDER BY (sum(CASE WHEN r.grade = 'again' THEN 1 ELSE 0 END)::float / count(*)) DESC`;
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    total: Number(r.total),
    againRate: Number(r.again) / Number(r.total),
  }));
}

// --- Activity: distinct active students per week, last 8 weeks ---

export interface ActivityPoint {
  weekStart: Date;
  active: number;
}

async function distinctActiveInWindow(db: Db, start: Date, end: Date): Promise<number> {
  const rows = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(DISTINCT ae.user_id) AS c
    FROM analytics_events ae
    JOIN users u ON u.id = ae.user_id
    WHERE u.role = 'student' AND ae.created_at >= ${start} AND ae.created_at < ${end}`;
  return Number(rows[0]?.c ?? 0);
}

export async function computeActivitySeries(db: Db, now: Date): Promise<ActivityPoint[]> {
  const points: ActivityPoint[] = [];
  for (let k = ACTIVITY_WEEKS - 1; k >= 0; k -= 1) {
    const end = new Date(now.getTime() - k * 7 * DAY_MS);
    const start = new Date(end.getTime() - 7 * DAY_MS);
    points.push({ weekStart: start, active: await distinctActiveInWindow(db, start, end) });
  }
  return points;
}

// --- Mock stats (spec 7.13/8.5) ---

export interface MockStats {
  completed: number;
  verdicts: { ready: number; needs_work: number; not_ready: number };
  avgHoursToFeedback: number | null;
}

export async function computeMockStats(db: Db, now: Date, days: number): Promise<MockStats> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const [completed, verdictGroups, feedbacks] = await Promise.all([
    db.booking.count({ where: { status: "completed", slot: { startsAt: { gte: since } } } }),
    db.feedback.groupBy({
      by: ["verdict"],
      where: { status: "published", publishedAt: { gte: since } },
      _count: { _all: true },
    }),
    db.feedback.findMany({
      where: { status: "published", publishedAt: { gte: since } },
      select: { publishedAt: true, booking: { select: { slot: { select: { endsAt: true } } } } },
    }),
  ]);

  const verdicts = { ready: 0, needs_work: 0, not_ready: 0 };
  for (const g of verdictGroups) verdicts[g.verdict] = g._count._all;

  // Time from mock end to feedback publication (spec: время до фидбека).
  const deltas = feedbacks
    .filter((f) => f.publishedAt)
    .map((f) => (f.publishedAt!.getTime() - f.booking.slot.endsAt.getTime()) / (60 * 60 * 1000))
    .filter((h) => h >= 0);
  const avgHoursToFeedback =
    deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;

  return { completed, verdicts, avgHoursToFeedback };
}

// --- Guide stats (spec 7.13: витрина гайдов) ---

export interface GuideStatRow {
  id: string;
  title: string;
  count: number;
}

export interface GuideStats {
  mostRead: GuideStatRow[];
  topBookmarked: GuideStatRow[];
}

export async function computeGuideStats(db: Db, now: Date, days: number): Promise<GuideStats> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const [readRows, bookmarkGroups] = await Promise.all([
    db.$queryRaw<{ gid: string; c: bigint }[]>`
      SELECT payload->>'guideId' AS gid, count(*) AS c
      FROM analytics_events
      WHERE type = 'guide.opened' AND created_at >= ${since} AND payload->>'guideId' IS NOT NULL
      GROUP BY payload->>'guideId'
      ORDER BY c DESC LIMIT 10`,
    db.bookmark.groupBy({
      by: ["guideId"],
      _count: { _all: true },
      orderBy: { _count: { guideId: "desc" } },
      take: 10,
    }),
  ]);

  const readGids = readRows.map((r) => r.gid);
  const bookmarkGids = bookmarkGroups.map((g) => g.guideId);
  const titles = new Map(
    (
      await db.guide.findMany({
        where: { id: { in: [...new Set([...readGids, ...bookmarkGids])] } },
        select: { id: true, title: true },
      })
    ).map((g) => [g.id, g.title]),
  );

  return {
    mostRead: readRows.map((r) => ({
      id: r.gid,
      title: titles.get(r.gid) ?? "—",
      count: Number(r.c),
    })),
    topBookmarked: bookmarkGroups.map((g) => ({
      id: g.guideId,
      title: titles.get(g.guideId) ?? "—",
      count: g._count._all,
    })),
  };
}

// --- Serializable activity DTO (spec 12.1/A1) ---
//
// A1 root cause: `unstable_cache` serializes its stored value, and a `Date` field
// round-trips to a STRING on a cache HIT. `ActivityPoint.weekStart` was a `Date`;
// on the second render of a given period the page called `weekStart.toISOString()`
// / `Intl.format(weekStart)` on a string → TypeError that took down the whole
// /admin/analytics route (the period tabs live inside the failed tree, so it stayed
// stuck). Fix: cached functions cross ONLY primitives — the week label is
// precomputed server-side here, no Date leaves the cache boundary.
const weekLabel = (d: Date) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(d);

export interface ActivityBar {
  key: string;
  label: string;
  active: number;
}

// --- Cached per-widget entry points (spec 12.1/A1) ---
//
// Split from the old monolithic `getAnalyticsBundle` so one failing aggregate no
// longer fails the whole page — each is wrapped in its own Suspense + error
// boundary on the page. Each returns fully serializable data (no `Date`), keyed by
// argument, cached 10 min, tag-invalidated. A throwing compute is NOT persisted by
// `unstable_cache` (only resolved values are cached) — never wrap a compute in a
// try/catch that returns an error sentinel here, or the error WOULD get cached.

export const getCourseFunnel = unstable_cache(
  async (courseId: string): Promise<CourseFunnel> => computeCourseFunnel(prisma, courseId),
  ["admin-analytics-funnel"],
  { revalidate: 600, tags: [ANALYTICS_CACHE_TAG] },
);

export const getTopFailed = unstable_cache(
  async (): Promise<FailedQuestion[]> => computeTopFailedQuestions(prisma),
  ["admin-analytics-top-failed"],
  { revalidate: 600, tags: [ANALYTICS_CACHE_TAG] },
);

export const getLagging = unstable_cache(
  async (days: number): Promise<LaggingCategory[]> =>
    computeLaggingCategories(prisma, new Date(), days),
  ["admin-analytics-lagging"],
  { revalidate: 600, tags: [ANALYTICS_CACHE_TAG] },
);

export const getActivityBars = unstable_cache(
  async (): Promise<ActivityBar[]> => {
    const series = await computeActivitySeries(prisma, new Date());
    return series.map((p) => ({
      key: p.weekStart.toISOString(),
      label: weekLabel(p.weekStart),
      active: p.active,
    }));
  },
  ["admin-analytics-activity"],
  { revalidate: 600, tags: [ANALYTICS_CACHE_TAG] },
);

export const getMocks = unstable_cache(
  async (days: number): Promise<MockStats> => computeMockStats(prisma, new Date(), days),
  ["admin-analytics-mocks"],
  { revalidate: 600, tags: [ANALYTICS_CACHE_TAG] },
);

export const getGuides = unstable_cache(
  async (): Promise<GuideStats> => computeGuideStats(prisma, new Date(), 30),
  ["admin-analytics-guides"],
  { revalidate: 600, tags: [ANALYTICS_CACHE_TAG] },
);
