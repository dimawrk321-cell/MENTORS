import type { PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { getCourseView } from "@/lib/services/content";
import {
  chainCourses,
  chainTargetsAfter,
  isCourseComplete,
  requiredLessonCounts,
  unlockCourse,
} from "@/lib/services/course-access";
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

/**
 * Writes the planned order; returns how many courses actually moved.
 *
 * The CALLER supplies atomicity (runChainMigration wraps both halves in one
 * transaction). That matters: under the hard chain `courses.order` IS the unlock
 * order, and the intermediate states of this loop contain duplicate values. A
 * run that died half-way would leave those duplicates behind, and a re-run
 * derives its plan from the partially-written orders with createdAt breaking the
 * ties — which can permanently swap two courses.
 */
export async function applyChainOrder(db: Db): Promise<number> {
  const plan = await planChainOrder(db);
  const moves = plan.filter((row) => row.from !== row.to);
  for (const row of moves) {
    await db.course.update({ where: { id: row.id }, data: { order: row.to } });
  }
  return moves.length;
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
  input: { userId: string; email?: string; now?: Date },
): Promise<StudentMigrationReport> {
  const [chain, counts] = await Promise.all([chainCourses(db), requiredLessonCounts(db)]);
  const opened: string[] = [];

  const open = async (courseId: string, label: string) => {
    const { changed } = await unlockCourse(db, {
      userId: input.userId,
      courseId,
      by: "system",
      now: input.now,
    });
    if (changed) opened.push(label);
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

    if (isCourseComplete(view.state.modules, view.state.totalRequired)) {
      // Same walk the live chain does, empty links included (chainTargetsAfter).
      for (const next of chainTargetsAfter(chain, counts, index)) {
        await open(next.id, `${next.title} (после «${course.title}»)`);
      }
    }
  }
  return { userId: input.userId, email: input.email ?? "", opened };
}

export interface MigrationSummary {
  reports: StudentMigrationReport[];
  /** Students the migration produced no rows for (nothing earned yet). */
  untouched: number;
}

/**
 * Migrates EVERY student, including blocked and invited ones.
 *
 * An earlier version skipped non-active students «because they start like
 * newcomers» — but blocking only flips a status and revokes sessions, it does
 * not erase lesson_progress. A blocked student who is later reinstated would
 * come back to a catalog with everything shut, including courses they had
 * half-finished, and nothing re-runs this migration. A course_access row for a
 * student who cannot log in is inert, so granting it costs nothing and removes
 * the whole class of problem.
 */
export async function migrateAllStudents(db: Db, options: { now?: Date } = {}) {
  const students = await db.user.findMany({
    where: { role: "student" },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const reports: StudentMigrationReport[] = [];
  let untouched = 0;
  for (const student of students) {
    const report = await migrateStudentAccess(db, {
      userId: student.id,
      email: student.email,
      now: options.now,
    });
    if (report.opened.length > 0) reports.push(report);
    else untouched += 1;
  }
  return { reports, untouched };
}

export interface ChainMigrationResult extends MigrationSummary {
  moved: number;
  plan: OrderPlanRow[];
}

class DryRunRollback extends Error {}

/**
 * The whole migration as ONE unit: reorder, then grant.
 *
 * A dry run does exactly the same writes inside a transaction that is then
 * rolled back — it does NOT simulate them. That is the only way the preview can
 * be trusted: the student pass reads `courses.order`, so evaluating it against
 * the OLD order (as a simulation must) reports a different chain than the one
 * `--commit` produces. Caught on the stand, where the preview credited every
 * student with «NLP: продвинутый» purely because that course still sat first.
 */
export async function runChainMigration(
  db: PrismaClient,
  options: { commit: boolean; now?: Date },
): Promise<ChainMigrationResult> {
  const plan = await planChainOrder(db);

  const run = async (tx: Db): Promise<ChainMigrationResult> => {
    const moved = await applyChainOrder(tx);
    const summary = await migrateAllStudents(tx, { now: options.now });
    return { ...summary, moved, plan };
  };

  if (options.commit) {
    return db.$transaction(run, { timeout: 120_000, maxWait: 20_000 });
  }

  let preview: ChainMigrationResult | null = null;
  try {
    await db.$transaction(
      async (tx) => {
        preview = await run(tx);
        throw new DryRunRollback();
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return preview!;
}
