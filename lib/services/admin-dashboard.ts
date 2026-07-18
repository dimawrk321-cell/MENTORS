import { unstable_cache } from "next/cache";
import type { Db } from "@/lib/db";
import { prisma } from "@/lib/db";
import { DAY_MS, localDaysBetween } from "@/lib/utils/dates";
import { LINK_STALE_DAYS } from "@/lib/constants";

// Пульт (spec 8.5): weekly metrics with week-over-week delta + red-flag widgets.
// All aggregation is SQL/Prisma over analytics_events and domain tables (spec
// 7.13), cached 10 min (unstable_cache, tag "admin-pult" — invalidated when a
// flag is resolved). Compute functions take (db, now) so they stay unit-testable.

export const PULT_CACHE_TAG = "admin-pult";
const MISSING_DAYS = 7;
const EXPIRING_DAYS = 14;
const CONSECUTIVE_FAILS = 3;

export interface MetricDelta {
  current: number;
  previous: number;
  delta: number;
}

export interface WeeklyMetrics {
  activeStudents: MetricDelta; // WAU
  lessonsCompleted: MetricDelta;
  testsPassed: MetricDelta;
  mocksCompleted: MetricDelta;
}

/** Distinct active students in analytics_events within [start, end). */
async function distinctActiveStudents(db: Db, start: Date, end: Date): Promise<number> {
  const rows = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(DISTINCT ae.user_id) AS c
    FROM analytics_events ae
    JOIN users u ON u.id = ae.user_id
    WHERE u.role = 'student' AND ae.created_at >= ${start} AND ae.created_at < ${end}`;
  return Number(rows[0]?.c ?? 0);
}

async function eventCount(db: Db, type: string, start: Date, end: Date): Promise<number> {
  return db.analyticsEvent.count({ where: { type, createdAt: { gte: start, lt: end } } });
}

export async function computeWeeklyMetrics(db: Db, now: Date): Promise<WeeklyMetrics> {
  const curStart = new Date(now.getTime() - 7 * DAY_MS);
  const prevStart = new Date(now.getTime() - 14 * DAY_MS);

  const metric = async (
    currentP: Promise<number>,
    prevP: Promise<number>,
  ): Promise<MetricDelta> => {
    const [current, previous] = await Promise.all([currentP, prevP]);
    return { current, previous, delta: current - previous };
  };

  const [activeStudents, lessonsCompleted, testsPassed, mocksCompleted] = await Promise.all([
    metric(
      distinctActiveStudents(db, curStart, now),
      distinctActiveStudents(db, prevStart, curStart),
    ),
    metric(
      eventCount(db, "lesson.completed", curStart, now),
      eventCount(db, "lesson.completed", prevStart, curStart),
    ),
    metric(
      eventCount(db, "test.passed", curStart, now),
      eventCount(db, "test.passed", prevStart, curStart),
    ),
    metric(
      eventCount(db, "mock.completed", curStart, now),
      eventCount(db, "mock.completed", prevStart, curStart),
    ),
  ]);

  return { activeStudents, lessonsCompleted, testsPassed, mocksCompleted };
}

// --- Red flags ---

export interface StudentRef {
  id: string;
  name: string;
  email: string;
}

export interface MissingStudent extends StudentRef {
  lastSeenAt: Date | null;
  daysMissing: number;
}

export interface ExpiringStudent extends StudentRef {
  accessUntil: Date;
  daysLeft: number;
}

export interface FlagRow {
  id: string;
  label: string;
  href: string;
  meta?: string;
}

export interface OpenReport {
  id: string;
  type: string;
  authorName: string;
  target: string;
  // null when the report targets neither a lesson nor a question (general report):
  // the row is then rendered as plain text, not a dead «#» link (spec 12.1/A2).
  href: string | null;
  text: string | null;
}

export interface RedFlags {
  missing: MissingStudent[];
  failingThree: StudentRef[];
  securityFlags: FlagRow[];
  videoUnavailable: FlagRow[];
  expiring: ExpiringStudent[];
  staleRecordings: FlagRow[];
  openReports: OpenReport[];
}

/** Active students not seen for 7+ local days (spec 8.5), longest gone first. */
async function missingStudents(db: Db, now: Date): Promise<MissingStudent[]> {
  const students = await db.user.findMany({
    where: { role: "student", status: "active" },
    select: { id: true, name: true, email: true, timezone: true, lastSeenAt: true },
  });
  return students
    .map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      lastSeenAt: s.lastSeenAt,
      daysMissing: s.lastSeenAt ? localDaysBetween(s.lastSeenAt, now, s.timezone) : Infinity,
    }))
    .filter((s) => s.daysMissing >= MISSING_DAYS)
    .sort((a, b) => b.daysMissing - a.daysMissing)
    .map((s) => ({ ...s, daysMissing: Number.isFinite(s.daysMissing) ? s.daysMissing : 0 }));
}

/** Students whose last 3 finished module-test attempts are all failures (spec 8.5). */
async function failingThreeStudents(db: Db): Promise<StudentRef[]> {
  const attempts = await db.testAttempt.findMany({
    where: { kind: "module", finishedAt: { not: null } },
    select: {
      userId: true,
      passed: true,
      finishedAt: true,
      user: { select: { name: true, email: true, role: true, status: true } },
    },
    orderBy: [{ userId: "asc" }, { finishedAt: "desc" }],
  });

  const byUser = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const flagged: StudentRef[] = [];
  for (const [userId, list] of byUser) {
    const first = list[0];
    if (!first || first.user.role !== "student" || first.user.status !== "active") continue;
    if (list.length < CONSECUTIVE_FAILS) continue;
    if (list.slice(0, CONSECUTIVE_FAILS).every((a) => a.passed === false)) {
      flagged.push({ id: userId, name: first.user.name, email: first.user.email });
    }
  }
  return flagged;
}

export async function computeRedFlags(db: Db, now: Date): Promise<RedFlags> {
  const staleCutoff = new Date(now.getTime() - LINK_STALE_DAYS * DAY_MS);
  const expiringUntil = new Date(now.getTime() + EXPIRING_DAYS * DAY_MS);

  const [
    missing,
    failingThree,
    securityFlags,
    videoUnavailable,
    expiring,
    staleRecordings,
    openReports,
  ] = await Promise.all([
    missingStudents(db, now),
    failingThreeStudents(db),
    db.securityFlag
      .findMany({
        where: { status: "open" },
        select: {
          id: true,
          type: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      })
      .then((flags) =>
        flags.map((f) => ({
          id: f.id,
          label: f.user.name,
          href: `/admin/students/${f.user.id}`,
          meta: f.type,
        })),
      ),
    db.lesson
      .findMany({
        where: { videoStatus: "unavailable" },
        select: {
          id: true,
          title: true,
          module: { select: { course: { select: { title: true } } } },
        },
        orderBy: { updatedAt: "desc" },
      })
      .then((lessons) =>
        lessons.map((l) => ({
          id: l.id,
          label: l.title,
          href: `/admin/content/lessons/${l.id}`,
          meta: l.module.course.title,
        })),
      ),
    db.user
      .findMany({
        where: { role: "student", status: "active", accessUntil: { gte: now, lte: expiringUntil } },
        select: { id: true, name: true, email: true, accessUntil: true, timezone: true },
        orderBy: { accessUntil: "asc" },
      })
      .then((students) =>
        students.map((s) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          accessUntil: s.accessUntil!,
          daysLeft: localDaysBetween(now, s.accessUntil!, s.timezone),
        })),
      ),
    db.recording
      .findMany({
        where: { linkUpdatedAt: { lt: staleCutoff } },
        select: { id: true, title: true, linkUpdatedAt: true },
        orderBy: { linkUpdatedAt: "asc" },
      })
      .then((recs) =>
        recs.map((r) => ({
          id: r.id,
          label: r.title,
          href: `/admin/library`,
          meta: `обновлена ${Math.floor((now.getTime() - r.linkUpdatedAt.getTime()) / DAY_MS)} дн. назад`,
        })),
      ),
    db.contentReport
      .findMany({
        where: { status: "open" },
        select: {
          id: true,
          type: true,
          text: true,
          user: { select: { name: true } },
          lesson: { select: { id: true, title: true } },
          question: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
      })
      .then((reports) =>
        reports.map((r) => ({
          id: r.id,
          type: r.type,
          authorName: r.user.name,
          text: r.text,
          target: r.lesson ? r.lesson.title : r.question ? "Вопрос" : "—",
          href: r.lesson
            ? `/admin/content/lessons/${r.lesson.id}`
            : r.question
              ? `/admin/questions/${r.question.id}`
              : null,
        })),
      ),
  ]);

  return {
    missing,
    failingThree,
    securityFlags,
    videoUnavailable,
    expiring,
    staleRecordings,
    openReports,
  };
}

export interface PultData {
  metrics: WeeklyMetrics;
  flags: RedFlags;
}

export async function computePultData(db: Db, now: Date): Promise<PultData> {
  const [metrics, flags] = await Promise.all([
    computeWeeklyMetrics(db, now),
    computeRedFlags(db, now),
  ]);
  return { metrics, flags };
}

/** Cached entry point for the page (10 min, tag-invalidated on flag resolution). */
export const getPultData = unstable_cache(
  async (): Promise<PultData> => computePultData(prisma, new Date()),
  ["admin-pult"],
  { revalidate: 600, tags: [PULT_CACHE_TAG] },
);
