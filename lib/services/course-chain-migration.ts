import type { Db } from "@/lib/db";
import { getCourseView } from "@/lib/services/content";
import { chainCourses, isCourseComplete, unlockCourse } from "@/lib/services/course-access";
import { WELCOME_COURSE_SLUG } from "@/lib/services/welcome-course";

// One-off migration onto the hard chain (walk 13.6, block 2v2.2 + 2v2.5), kept in
// a service so it is testable and so the CLI (scripts/migrate-course-chain.ts) is
// only printing. Both halves are idempotent — a second run changes nothing.

/**
 * The owner's starting chain (block 2v2.2). Slugs missing from a given database
 * are skipped; courses not listed keep their relative order and follow these.
 */
export const CHAIN_HEAD = [
  WELCOME_COURSE_SLUG,
  "python-pytorch",
  "classic-ml-course",
  "nlp-basic",
  "nlp-advanced",
] as const;

export interface OrderPlanRow {
  id: string;
  slug: string;
  title: string;
  from: number;
  to: number;
}

/** The target `courses.order` for every course — drafts included. */
export async function planChainOrder(db: Db): Promise<OrderPlanRow[]> {
  const courses = await db.course.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, slug: true, title: true, order: true },
  });
  const head = CHAIN_HEAD.map((slug) => courses.find((c) => c.slug === slug)).filter(
    (c): c is (typeof courses)[number] => Boolean(c),
  );
  const headIds = new Set(head.map((c) => c.id));
  const target = [...head, ...courses.filter((c) => !headIds.has(c.id))];

  return target.map((course, index) => ({
    id: course.id,
    slug: course.slug,
    title: course.title,
    from: course.order,
    to: index,
  }));
}

/** Writes the planned order; returns how many courses actually moved. */
export async function applyChainOrder(db: Db): Promise<number> {
  const plan = await planChainOrder(db);
  let moved = 0;
  for (const row of plan) {
    if (row.from === row.to) continue;
    await db.course.update({ where: { id: row.id }, data: { order: row.to } });
    moved += 1;
  }
  return moved;
}

export interface StudentMigrationReport {
  userId: string;
  email: string;
  /** Human-readable list of courses this run opened (empty on a repeat run). */
  opened: string[];
}

/**
 * Gives one student the access they have already earned (block 2v2.5):
 *   • welcome — always;
 *   • any course they have touched (a completed or current lesson);
 *   • the next link after any course they have FINISHED — the live chain fires on
 *     the completion event, which is in the past for them, so without this they
 *     would sit locked behind a course they already passed.
 * Everything else stays chain-locked and opens normally from now on.
 */
export async function migrateStudentAccess(
  db: Db,
  input: { userId: string; email?: string; now?: Date; commit?: boolean },
): Promise<StudentMigrationReport> {
  const commit = input.commit ?? true;
  const chain = await chainCourses(db);
  const opened: string[] = [];
  const wouldOpen = new Set<string>();

  const open = async (courseId: string, label: string) => {
    if (commit) {
      const { changed } = await unlockCourse(db, {
        userId: input.userId,
        courseId,
        by: "system",
        now: input.now,
      });
      if (changed) opened.push(label);
      return;
    }
    // Dry run: mirror unlockCourse's decision without writing, so `--commit`
    // opens exactly what the preview promised.
    if (wouldOpen.has(courseId)) return;
    const row = await db.courseAccess.findUnique({
      where: { userId_courseId: { userId: input.userId, courseId } },
      select: { unlockedAt: true, lockedByAdmin: true },
    });
    if (row?.lockedByAdmin || row?.unlockedAt) return;
    wouldOpen.add(courseId);
    opened.push(label);
  };

  // «Touched» = a real progress row. NOT `state.lessons[].current`: in a free- or
  // recommended-gated course the first lesson is «current» for everyone, which
  // would silently open the whole catalog.
  const progressRows = await db.lessonProgress.findMany({
    where: { userId: input.userId },
    select: { lesson: { select: { module: { select: { courseId: true } } } } },
  });
  const touchedCourses = new Set(progressRows.map((row) => row.lesson.module.courseId));

  for (const [index, course] of chain.entries()) {
    const view = await getCourseView(db, course.slug, input.userId);
    if (!view) continue;
    // index 0 is the chain's entry point (welcome after the order pass) — same
    // rule `resolve` uses, so the migration cannot disagree with live access.
    if (index === 0 || touchedCourses.has(course.id)) {
      await open(course.id, course.title);
    }

    const next = chain[index + 1];
    if (next && isCourseComplete(view.state.modules, view.state.totalRequired)) {
      await open(next.id, `${next.title} (после «${course.title}»)`);
    }
  }
  return { userId: input.userId, email: input.email ?? "", opened };
}

export interface MigrationSummary {
  reports: StudentMigrationReport[];
  /** Students left untouched: blocked/invited — they start like newcomers. */
  skipped: number;
}

export async function migrateAllStudents(
  db: Db,
  options: { now?: Date; commit?: boolean } = {},
): Promise<MigrationSummary> {
  const students = await db.user.findMany({
    where: { role: "student" },
    select: { id: true, email: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  const reports: StudentMigrationReport[] = [];
  let skipped = 0;
  for (const student of students) {
    if (student.status !== "active" && student.status !== "expired") {
      skipped += 1;
      continue;
    }
    const report = await migrateStudentAccess(db, {
      userId: student.id,
      email: student.email,
      now: options.now,
      commit: options.commit,
    });
    if (report.opened.length > 0) reports.push(report);
  }
  return { reports, skipped };
}
