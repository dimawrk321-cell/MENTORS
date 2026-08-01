import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";

// Hard course chain (changelog 13.6, block 2v2). Courses open one after another
// along a SINGLE global order (courses.order, edited in the content studio);
// tracks are only a label now and no longer reorder anything.
//
// Resolution precedence, highest first:
//   1. locked_by_admin   — an admin lock outranks the chain entirely;
//   2. unlocked_at       — unlocked by the system (chain) or by an admin;
//   3. FIRST in the chain — always open, so a student always has a way in;
//   4. otherwise         — locked.
//
// Rule 3 keys on the chain POSITION, not on the welcome slug: keying on the slug
// meant that unpublishing or renaming the welcome course locked every student
// out of the entire catalog with no way back. After the order migration the
// first link IS welcome, so the visible behaviour is the same.
//
// In-course gating (strict|recommended|free, spec 7.3) is untouched: this layer
// only decides whether the course itself is reachable.

export type CourseAccessState =
  "open_welcome" | "open_system" | "open_admin" | "locked_chain" | "locked_admin";

export interface CourseAccessRow {
  courseId: string;
  slug: string;
  title: string;
  order: number;
  state: CourseAccessState;
  /** Title of the course that must be finished first (locked_chain only). */
  unlocksAfter: string | null;
}

export function isOpen(state: CourseAccessState): boolean {
  return state === "open_welcome" || state === "open_system" || state === "open_admin";
}

interface AccessRecord {
  courseId: string;
  unlockedAt: Date | null;
  lockedByAdmin: boolean;
  unlockedBy: "system" | "admin" | null;
}

function resolve(isFirstInChain: boolean, record: AccessRecord | undefined): CourseAccessState {
  if (record?.lockedByAdmin) return "locked_admin";
  if (record?.unlockedAt) return record.unlockedBy === "admin" ? "open_admin" : "open_system";
  if (isFirstInChain) return "open_welcome";
  return "locked_chain";
}

/**
 * A course counts as finished when EVERY module is closed. `ModuleState.closed`
 * already means «all required lessons completed AND the module test passed»
 * (computeCourseState), which is exactly the chain's completion rule.
 *
 * `totalRequired === 0` is NOT completion: an empty or lessons-less course has
 * nothing to finish, and treating it as done would cascade the chain open for
 * everyone (same rule markRecommendedPath uses for the «пройден» tick).
 */
export function isCourseComplete(
  modules: Map<string, { closed: boolean }>,
  totalRequired: number,
): boolean {
  if (modules.size === 0 || totalRequired === 0) return false;
  for (const state of modules.values()) if (!state.closed) return false;
  return true;
}

/** The global chain: every published course ordered by `order`, then createdAt. */
export async function chainCourses(db: Db) {
  return db.course.findMany({
    where: { status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, slug: true, title: true, order: true },
  });
}

/** Access state for every published course, in chain order. */
export async function listCourseAccess(db: Db, userId: string): Promise<CourseAccessRow[]> {
  const [courses, records] = await Promise.all([
    chainCourses(db),
    db.courseAccess.findMany({
      where: { userId },
      select: { courseId: true, unlockedAt: true, lockedByAdmin: true, unlockedBy: true },
    }),
  ]);
  const byCourse = new Map(records.map((r) => [r.courseId, r as AccessRecord]));

  return courses.map((course, index) => {
    const state = resolve(index === 0, byCourse.get(course.id));
    return {
      courseId: course.id,
      slug: course.slug,
      title: course.title,
      order: course.order,
      state,
      // «Откроется после {курс}» — the previous link in the chain.
      unlocksAfter: state === "locked_chain" && index > 0 ? courses[index - 1]!.title : null,
    };
  });
}

/** Single-course check used by the page guards and the student actions. */
export async function canOpenCourse(db: Db, userId: string, courseId: string): Promise<boolean> {
  const [course, first, record] = await Promise.all([
    db.course.findUnique({ where: { id: courseId }, select: { id: true } }),
    db.course.findFirst({
      where: { status: "published" },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    }),
    db.courseAccess.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { courseId: true, unlockedAt: true, lockedByAdmin: true, unlockedBy: true },
    }),
  ]);
  if (!course) return false;
  return isOpen(resolve(first?.id === course.id, record ?? undefined));
}

/**
 * Opens a course for a student. Idempotent: re-opening an already-open course is
 * a no-op, and it never clears an admin lock unless `force` says so (the admin
 * «открыть досрочно» control passes force, the chain never does).
 */
export async function unlockCourse(
  db: Db,
  input: {
    userId: string;
    courseId: string;
    by: "system" | "admin";
    now?: Date;
    /** Admin unlock also lifts an admin lock; the chain must not. */
    force?: boolean;
  },
): Promise<{ changed: boolean }> {
  const now = input.now ?? new Date();
  const existing = await db.courseAccess.findUnique({
    where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
  });

  if (existing?.lockedByAdmin && !input.force) return { changed: false };
  if (existing?.unlockedAt && !existing.lockedByAdmin) return { changed: false };

  try {
    await db.courseAccess.upsert({
      where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
      create: {
        userId: input.userId,
        courseId: input.courseId,
        unlockedAt: now,
        unlockedBy: input.by,
        lockedByAdmin: false,
      },
      update: {
        unlockedAt: now,
        unlockedBy: input.by,
        ...(input.force ? { lockedByAdmin: false } : {}),
      },
    });
  } catch (error) {
    // Two lessons finished at the same instant can both close the course and race
    // to open the next one; Prisma's upsert is not atomic, so the loser hits the
    // unique index. The row exists either way — report «no change» so the student
    // gets one notification, not an error on a lesson that did complete.
    if (isUniqueViolation(error)) return { changed: false };
    throw error;
  }
  return { changed: true };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

/** Admin lock — outranks the chain; the course stays shut even if earned. */
export async function setAdminLock(
  db: Db,
  input: { userId: string; courseId: string; locked: boolean },
): Promise<void> {
  await db.courseAccess.upsert({
    where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
    create: {
      userId: input.userId,
      courseId: input.courseId,
      lockedByAdmin: input.locked,
      unlockedAt: null,
    },
    update: { lockedByAdmin: input.locked },
  });
}

// --- Admin handles (block 2v2.4) ---

export type AdminCourseAccessAction = "unlock" | "lock" | "unlock_reset";

/**
 * The three admin controls in the student card, each audited (block 2v2.4):
 *   • unlock       — open the course early (unlocked_by=admin, lifts a lock too);
 *   • lock         — admin lock, stronger than the chain;
 *   • unlock_reset — undo the admin's own decisions and hand the course back to
 *     the chain. Deliberately NOT a row delete: a course the student EARNED
 *     (unlocked_by=system) must stay open after an admin lock is lifted, so only
 *     the admin's own marks are cleared.
 * Returns the resulting state so the UI shows the truth instead of a guess.
 * No bulk variant by owner's decision — one student at a time.
 */
export async function adminSetCourseAccess(
  db: Db,
  input: {
    actorId: string;
    userId: string;
    courseId: string;
    action: AdminCourseAccessAction;
    now?: Date;
  },
): Promise<{ ok: true; state: CourseAccessState } | { ok: false; code: "not_found" }> {
  const [user, course, first] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true } }),
    db.course.findUnique({ where: { id: input.courseId }, select: { id: true } }),
    db.course.findFirst({
      where: { status: "published" },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    }),
  ]);
  if (!user || user.role !== "student" || !course) return { ok: false, code: "not_found" };

  const snapshot = async () => {
    const row = await db.courseAccess.findUnique({
      where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
      select: { unlockedAt: true, unlockedBy: true, lockedByAdmin: true },
    });
    return {
      courseId: input.courseId,
      unlockedAt: row?.unlockedAt?.toISOString() ?? null,
      unlockedBy: row?.unlockedBy ?? null,
      lockedByAdmin: row?.lockedByAdmin ?? false,
    };
  };
  const before = await snapshot();

  if (input.action === "lock") {
    await setAdminLock(db, { userId: input.userId, courseId: input.courseId, locked: true });
  } else if (input.action === "unlock") {
    await unlockCourse(db, {
      userId: input.userId,
      courseId: input.courseId,
      by: "admin",
      now: input.now,
      force: true,
    });
  } else {
    const undoEarlyOpen = before.unlockedBy === "admin";
    await db.courseAccess.updateMany({
      where: { userId: input.userId, courseId: input.courseId },
      data: {
        lockedByAdmin: false,
        // A system unlock is the student's own progress — keep it.
        ...(undoEarlyOpen ? { unlockedAt: null, unlockedBy: null } : {}),
      },
    });
  }

  const after = await snapshot();
  await writeAudit(db, {
    actorId: input.actorId,
    action: `user.course_access_${input.action}`,
    entityType: "user",
    entityId: input.userId,
    before,
    after,
  });
  return {
    ok: true,
    state: resolve(first?.id === course.id, {
      courseId: input.courseId,
      unlockedAt: after.unlockedAt ? new Date(after.unlockedAt) : null,
      lockedByAdmin: after.lockedByAdmin,
      unlockedBy: after.unlockedBy,
    }),
  };
}

// No «initialise a new student» step exists on purpose: `resolve` already treats
// a rowless welcome course as open, so a newcomer needs no rows at all and there
// is nothing to backfill when a student is created.

/**
 * Required published lessons per published course. A course with none of them
 * can never be «completed» (isCourseComplete refuses), so it must not be able to
 * hold the chain shut — see hasContent below.
 */
export async function requiredLessonCounts(db: Db): Promise<Map<string, number>> {
  const rows = await db.lesson.groupBy({
    by: ["moduleId"],
    where: {
      status: "published",
      isOptional: false,
      module: { status: "published", course: { status: "published" } },
    },
    _count: { _all: true },
  });
  const modules = await db.module.findMany({
    where: { id: { in: rows.map((r) => r.moduleId) } },
    select: { id: true, courseId: true },
  });
  const courseOf = new Map(modules.map((m) => [m.id, m.courseId]));
  const counts = new Map<string, number>();
  for (const row of rows) {
    const courseId = courseOf.get(row.moduleId);
    if (!courseId) continue;
    counts.set(courseId, (counts.get(courseId) ?? 0) + row._count._all);
  }
  return counts;
}

/**
 * Called after a course is completed: opens the next link(s) in the chain.
 *
 * An EMPTY course (no required published lessons) is opened but never blocks:
 * it has nothing to finish, so it can never fire the completion that would open
 * what follows, and a student would sit behind it forever. The stand has four
 * such published shells today, one of them mid-chain — so the walk continues
 * past them up to and including the first course that actually has content.
 *
 * Returns the first course WITH content that this call opened (that is the one
 * worth a notification), or null when nothing new was opened.
 */
export async function unlockNextAfter(
  db: Db,
  input: { userId: string; completedCourseId: string; now?: Date },
): Promise<{ id: string; title: string } | null> {
  const [courses, counts] = await Promise.all([chainCourses(db), requiredLessonCounts(db)]);
  const index = courses.findIndex((c) => c.id === input.completedCourseId);
  if (index === -1) return null;

  let announced: { id: string; title: string } | null = null;
  for (const course of chainTargetsAfter(courses, counts, index)) {
    const { changed } = await unlockCourse(db, {
      userId: input.userId,
      courseId: course.id,
      by: "system",
      now: input.now,
    });
    if (changed && (counts.get(course.id) ?? 0) > 0 && !announced) {
      announced = { id: course.id, title: course.title };
    }
  }
  return announced;
}

/**
 * The courses to open once the course at `fromIndex` is finished: every empty
 * link that follows plus the first one with content. Pure, so the migration's
 * dry run can promise exactly what the live chain would do.
 */
export function chainTargetsAfter<T extends { id: string }>(
  courses: T[],
  counts: Map<string, number>,
  fromIndex: number,
): T[] {
  const targets: T[] = [];
  for (let i = fromIndex + 1; i < courses.length; i += 1) {
    const course = courses[i]!;
    targets.push(course);
    if ((counts.get(course.id) ?? 0) > 0) break;
  }
  return targets;
}
