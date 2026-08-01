// Course path badges (changelog 13.6). The soft ordering that used to live here
// (welcome → track order → own order) was REPLACED by the hard chain in block
// 2v2: courses are now ordered by one global `courses.order` and gated by
// course_access. What survives is the «Начни отсюда» / «пройден» marking, which
// rides on top of the chain (2v2.6) — see lib/services/course-access.ts.

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
