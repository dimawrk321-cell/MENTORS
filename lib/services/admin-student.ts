import type { Db } from "@/lib/db";
import { DAY_MS } from "@/lib/utils/dates";
import { getTrainerStats, type TrainerStats } from "@/lib/services/srs";

// Аггрегаторы вкладок карточки ученика (spec 8.5): прогресс, тесты, повторения,
// моки, события. Только чтение; вызываются из /admin/students/[id].

// --- Прогресс ---

export interface ModuleProgress {
  id: string;
  title: string;
  completed: number;
  total: number;
}
export interface CourseProgress {
  id: string;
  title: string;
  completed: number;
  total: number;
  pct: number;
  lastActivityAt: Date | null;
  modules: ModuleProgress[];
}

export async function getStudentProgress(db: Db, userId: string): Promise<CourseProgress[]> {
  const courses = await db.course.findMany({
    where: { status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: {
      modules: {
        where: { status: "published" },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: { lessons: { where: { status: "published" }, select: { id: true } } },
      },
    },
  });
  const progress = await db.lessonProgress.findMany({
    where: { userId, status: "completed" },
    select: { lessonId: true, completedAt: true },
  });
  const completedAt = new Map(progress.map((p) => [p.lessonId, p.completedAt]));

  return courses
    .map((course) => {
      let lastActivityAt: Date | null = null;
      const modules = course.modules.map((m) => {
        let done = 0;
        for (const lesson of m.lessons) {
          const at = completedAt.get(lesson.id);
          if (at !== undefined) {
            done += 1;
            if (at && (!lastActivityAt || at > lastActivityAt)) lastActivityAt = at;
          }
        }
        return { id: m.id, title: m.title, completed: done, total: m.lessons.length };
      });
      const total = modules.reduce((a, m) => a + m.total, 0);
      const completed = modules.reduce((a, m) => a + m.completed, 0);
      return {
        id: course.id,
        title: course.title,
        completed,
        total,
        pct: total > 0 ? Math.round((completed / total) * 100) : 0,
        lastActivityAt,
        modules,
      };
    })
    .filter((c) => c.total > 0);
}

// --- Тесты ---

export interface TestAttemptRow {
  id: string;
  courseTitle: string;
  moduleTitle: string;
  kind: string;
  score: number;
  passed: boolean;
  finished: boolean;
  finishedAt: Date | null;
  startedAt: Date;
}

export async function getStudentTestAttempts(db: Db, userId: string): Promise<TestAttemptRow[]> {
  const attempts = await db.testAttempt.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { module: { select: { title: true, course: { select: { title: true } } } } },
  });
  return attempts.map((a) => ({
    id: a.id,
    courseTitle: a.module.course.title,
    moduleTitle: a.module.title,
    kind: a.kind,
    score: a.score,
    passed: a.passed,
    finished: a.finishedAt !== null,
    finishedAt: a.finishedAt,
    startedAt: a.startedAt,
  }));
}

// --- Повторения ---

export interface StudentLaggingCategory {
  id: string;
  title: string;
  colorIndex: number;
  againRate: number;
  total: number;
}
export interface StudentReviewSummary {
  stats: TrainerStats;
  lagging: StudentLaggingCategory[];
}

/**
 * SRS-статистика ученика + западающие категории за 30 дней (spec 8.5). В отличие
 * от дашбордного блока (порог 20 ответов, spec 8.3) админ-диагностика показывает
 * категории с любого числа повторений — чтобы разбирать даже слабую активность.
 */
export async function getStudentReviewSummary(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<StudentReviewSummary> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [stats, rows] = await Promise.all([
    getTrainerStats(db, { userId, now }),
    db.$queryRaw<
      { id: string; title: string; color_index: number; again: bigint; total: bigint }[]
    >`
      SELECT qc.id, qc.title, qc.color_index,
        sum(CASE WHEN r.grade = 'again' THEN 1 ELSE 0 END) AS again,
        count(*) AS total
      FROM srs_reviews r
      JOIN srs_cards c ON c.id = r.card_id
      JOIN questions q ON q.id = c.question_id
      JOIN question_categories qc ON qc.id = q.category_id
      WHERE c.user_id = ${userId} AND r.reviewed_at >= ${since}
      GROUP BY qc.id, qc.title, qc.color_index
      HAVING count(*) >= 1
      ORDER BY (sum(CASE WHEN r.grade = 'again' THEN 1 ELSE 0 END)::float / count(*)) DESC
      LIMIT 5`,
  ]);
  return {
    stats,
    lagging: rows.map((r) => ({
      id: r.id,
      title: r.title,
      colorIndex: r.color_index,
      total: Number(r.total),
      againRate: Number(r.again) / Number(r.total),
    })),
  };
}

// --- Моки ---

export interface StudentBookingRow {
  id: string;
  type: string;
  status: string;
  startsAt: Date;
  interviewerName: string;
  verdict: string | null;
}
export interface StudentStrikeRow {
  id: string;
  reason: string;
  createdAt: Date;
  bookingId: string;
}
export interface StudentMockHistory {
  bookings: StudentBookingRow[];
  strikes: StudentStrikeRow[];
}

export async function getStudentMockHistory(db: Db, userId: string): Promise<StudentMockHistory> {
  const [bookings, strikes] = await Promise.all([
    db.booking.findMany({
      where: { userId },
      orderBy: { slot: { startsAt: "desc" } },
      include: {
        slot: { select: { startsAt: true, interviewer: { select: { name: true } } } },
        feedback: { select: { verdict: true, status: true } },
      },
    }),
    db.bookingStrike.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, reason: true, createdAt: true, bookingId: true },
    }),
  ]);
  return {
    bookings: bookings.map((b) => ({
      id: b.id,
      type: b.type,
      status: b.status,
      startsAt: b.slot.startsAt,
      interviewerName: b.slot.interviewer.name,
      verdict: b.feedback?.status === "published" ? b.feedback.verdict : null,
    })),
    strikes,
  };
}

// --- События ---

export interface StudentEventRow {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export async function getStudentEvents(
  db: Db,
  userId: string,
  take = 50,
): Promise<StudentEventRow[]> {
  return db.analyticsEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, type: true, payload: true, createdAt: true },
  });
}
