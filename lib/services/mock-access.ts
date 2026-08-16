import type { Db } from "@/lib/db";
import { listCoursesForStudent } from "@/lib/services/content";

// Бронь мока открывается после первого пройденного курса (заход B.1, блок 3).
//
// Источник правды один. «Курс пройден» в системе считает `isCourseComplete` —
// тот же предикат, на котором стоит `advanceChainIfCourseComplete` (цепь курсов,
// заход 13.6) и галка «пройден» в каталоге; `listCoursesForStudent` уже отдаёт
// его результат полем `isCompleted`. Второго определения «пройденности» здесь
// НЕ заводится: их однажды уже разъезжало между `canOpenCourse` и
// `listCourseAccess`, и повторять это нельзя.
//
// Это правило НЕ смешивается с локом за страйки (`computeBookingLock`, spec
// 7.8): у них разные причины и разные тексты, и ученик должен понимать, какая
// из двух его касается. Лок временный и про дисциплину, это условие — про
// готовность; проверяются они независимо.

export interface MockBookingAccess {
  /** Можно ли занимать слот: бронь, перенос, лист ожидания. */
  open: boolean;
  /** Курс, которым бронь откроется, — для человеческого объяснения и ссылки. */
  nextCourse: { slug: string; title: string; progressPct: number } | null;
}

/**
 * Доступ ученика к брони мока. `open === true`, когда пройден хотя бы один
 * курс.
 *
 * DECISION: считается ЛЮБОЙ пройденный курс, включая вводный «Знакомство с
 * PRIME» — «первый курс» в формулировке владельца — это первое звено цепи, а
 * заводить исключение по слагу значило бы спрятать в коде второе, неписаное
 * правило. Курс без обязательных уроков пройденным не считается (правило цепи,
 * заход 13.6) — пустая заглушка бронь не откроет.
 */
export async function getMockBookingAccess(db: Db, userId: string): Promise<MockBookingAccess> {
  const courses = await listCoursesForStudent(db, userId);
  const open = courses.some((course) => course.isCompleted);
  if (open) return { open: true, nextCourse: null };

  // «Начни отсюда» уже указывает на первый открытый незавершённый курс — та же
  // точка, куда ведём ученика отсюда.
  const next =
    courses.find((course) => course.isNext) ??
    courses.find((course) => !course.locked && !course.isCompleted) ??
    null;
  return {
    open: false,
    nextCourse: next ? { slug: next.slug, title: next.title, progressPct: next.progressPct } : null,
  };
}

/** Короткая проверка для серверных действий. */
export async function canBookMocks(db: Db, userId: string): Promise<boolean> {
  return (await getMockBookingAccess(db, userId)).open;
}
