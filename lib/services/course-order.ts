// Course path badges (changelog 13.6). The soft ordering that used to live here
// (welcome → track order → own order) was REPLACED by the hard chain in block
// 2v2: courses are now ordered by one global `courses.order` and gated by
// course_access. What survives is the «Начни отсюда» / «пройден» marking, which
// rides on top of the chain (2v2.6) — see lib/services/course-access.ts.

/**
 * Marks the recommended next step: the FIRST course in the given (already
 * ordered) list that is not yet complete.
 *
 * Completion is supplied by the CALLER (`isCompleted`), not recomputed here.
 * This function used to derive it from required-lesson counts, which disagreed
 * with the chain's own rule (`isCourseComplete`: every module closed, i.e.
 * lessons AND the module test) exactly when a course ends in an enabled unpassed
 * test — so the catalog showed a green «пройден» tick next to «Откроется после
 * {этот курс}» on the same screen. One rule, one owner.
 */
export function markRecommendedPath<T extends { isCompleted: boolean }>(
  courses: T[],
): Array<T & { isNext: boolean }> {
  let nextTaken = false;
  return courses.map((course) => {
    const isNext = !course.isCompleted && !nextTaken;
    if (isNext) nextTaken = true;
    return { ...course, isNext };
  });
}
