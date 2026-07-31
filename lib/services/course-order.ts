import type { Track } from "@prisma/client";
import type { Db } from "@/lib/db";
import { WELCOME_COURSE_SLUG } from "@/lib/services/welcome-course";

// Recommended course path (changelog 13.6). ONE ordering used by both the catalog
// (/courses) and the dashboard hero, so the «next» course can never disagree
// between the two screens:
//   1. the welcome course always first — for every student, track or no track;
//   2. then the student's track order (tracks.course_ids);
//   3. then the course's own `order`.
// This is a navigation hint only: there is NO hard gating between courses
// (tracks overlap, the student may go out of order). In-course gating
// (strict|recommended|free, spec 7.3) is untouched.

/** Sorts already-fetched courses in place-safe fashion; needs only id/slug/order. */
export function sortByRecommendedPath<T extends { id: string; slug: string; order: number }>(
  courses: T[],
  trackOrder: string[],
): T[] {
  const rank = new Map(trackOrder.map((id, index) => [id, index]));
  return [...courses].sort((a, b) => {
    // Welcome outranks everything, including the track order.
    const wa = a.slug === WELCOME_COURSE_SLUG ? 0 : 1;
    const wb = b.slug === WELCOME_COURSE_SLUG ? 0 : 1;
    if (wa !== wb) return wa - wb;
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.order - b.order;
  });
}

/** Reads the track's course order (empty when the student has no track yet). */
export async function trackCourseOrder(db: Db, track: Track | null): Promise<string[]> {
  if (!track) return [];
  const trackDef = await db.trackDef.findUnique({ where: { key: track } });
  return (trackDef?.courseIds as string[] | undefined) ?? [];
}

/**
 * Marks the recommended next step: the FIRST course in the given (already
 * ordered) list that is not yet complete. Completed courses are those whose
 * required lessons are all done; a course with no required lessons at all is
 * not treated as complete (nothing to finish yet, so nothing to tick).
 */
export function markRecommendedPath<T extends { lessonsTotal: number; lessonsCompleted: number }>(
  courses: T[],
): Array<T & { isCompleted: boolean; isNext: boolean }> {
  let nextTaken = false;
  return courses.map((course) => {
    const isCompleted = course.lessonsTotal > 0 && course.lessonsCompleted >= course.lessonsTotal;
    const isNext = !isCompleted && !nextTaken;
    if (isNext) nextTaken = true;
    return { ...course, isCompleted, isNext };
  });
}
