import type { Db } from "@/lib/db";
import { WELCOME_COURSE_SLUG } from "@/lib/services/welcome-course";

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
 */
export function isCourseComplete(modules: Map<string, { closed: boolean }>): boolean {
  if (modules.size === 0) return false;
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

/** Ensures a brand-new student has the welcome course row (spec: only welcome). */
export async function ensureInitialAccess(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const welcome = await db.course.findUnique({
    where: { slug: WELCOME_COURSE_SLUG },
    select: { id: true },
  });
  if (!welcome) return;
  await db.courseAccess.upsert({
    where: { userId_courseId: { userId, courseId: welcome.id } },
    create: { userId, courseId: welcome.id, unlockedAt: now, unlockedBy: "system" },
    update: {},
  });
}

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
