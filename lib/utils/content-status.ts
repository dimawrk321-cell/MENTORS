// A3 (spec 13.1): a PUBLISHED course/module with no published lessons is an
// empty shell to students. These pure predicates drive the content-studio
// warning badge and the pre-publish confirm; kept here (client-safe, no imports)
// so the guard logic is unit-testable independent of the tree component.

interface LessonStatus {
  status: "draft" | "published";
}
interface ModuleLike {
  status: "draft" | "published";
  lessons: LessonStatus[];
}
interface CourseLike {
  status: "draft" | "published";
  modules: { lessons: LessonStatus[] }[];
}

/** Does this module have at least one published lesson? */
export function moduleHasPublishedLesson(m: ModuleLike): boolean {
  return m.lessons.some((l) => l.status === "published");
}

/** Does this course have at least one published lesson anywhere? */
export function courseHasPublishedLesson(c: CourseLike): boolean {
  return c.modules.some((m) => m.lessons.some((l) => l.status === "published"));
}

/** A published module with zero published lessons — the empty-shell warning case. */
export function isEmptyPublishedModule(m: ModuleLike): boolean {
  return m.status === "published" && !moduleHasPublishedLesson(m);
}

/** A published course with zero published lessons — the empty-shell warning case. */
export function isEmptyPublishedCourse(c: CourseLike): boolean {
  return c.status === "published" && !courseHasPublishedLesson(c);
}
