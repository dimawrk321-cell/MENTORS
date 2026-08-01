import type { Db } from "@/lib/db";
import { WELCOME_COURSE_SLUG } from "@/lib/services/welcome-course";
import { writeAudit } from "@/lib/services/audit";

// Hard course chain (changelog 13.6, block 2v2). Courses open one after another
// along a SINGLE global order (courses.order, edited in the content studio);
// tracks are only a label now and no longer reorder anything.
//
// Resolution precedence, highest first:
//   1. locked_by_admin  — an admin lock outranks the chain entirely;
//   2. unlocked_at      — unlocked by the system (chain) or by an admin;
//   3. welcome course   — always open, so a new student always has a way in;
//   4. otherwise        — locked.
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

function resolve(
  slug: string,
  record: AccessRecord | undefined,
): Exclude<CourseAccessState, "locked_chain"> | "locked_chain" {
  if (record?.lockedByAdmin) return "locked_admin";
  if (record?.unlockedAt) return record.unlockedBy === "admin" ? "open_admin" : "open_system";
  if (slug === WELCOME_COURSE_SLUG) return "open_welcome";
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
    const state = resolve(course.slug, byCourse.get(course.id));
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

/** Single-course check used by the course page guard. */
export async function canOpenCourse(db: Db, userId: string, courseId: string): Promise<boolean> {
  const [course, record] = await Promise.all([
    db.course.findUnique({ where: { id: courseId }, select: { slug: true } }),
    db.courseAccess.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { courseId: true, unlockedAt: true, lockedByAdmin: true, unlockedBy: true },
    }),
  ]);
  if (!course) return false;
  return isOpen(resolve(course.slug, record ?? undefined));
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
  return { changed: true };
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
  const [user, course] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true } }),
    db.course.findUnique({ where: { id: input.courseId }, select: { id: true, slug: true } }),
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
    state: resolve(course.slug, {
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
 * Called after a course is completed: opens the next link in the chain.
 * Returns the course that was opened (for the notification), or null.
 */
export async function unlockNextAfter(
  db: Db,
  input: { userId: string; completedCourseId: string; now?: Date },
): Promise<{ id: string; title: string } | null> {
  const courses = await chainCourses(db);
  const index = courses.findIndex((c) => c.id === input.completedCourseId);
  if (index === -1 || index === courses.length - 1) return null;

  const next = courses[index + 1]!;
  const { changed } = await unlockCourse(db, {
    userId: input.userId,
    courseId: next.id,
    by: "system",
    now: input.now,
  });
  return changed ? { id: next.id, title: next.title } : null;
}
