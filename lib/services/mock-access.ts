import type { Db } from "@/lib/db";
import { listCoursesForStudent } from "@/lib/services/content";
import { listStartingCourseIds } from "@/lib/services/course-access";

// Бронь мока открывается после первого ЗАРАБОТАННОГО курса (заход B.1, блок 3;
// уточнено перед деплоем).
//
// Правило владельца: бронь открывает курс, который НЕ был доступен ученику с
// самого начала. Вводное «Знакомство» проходится за вечер и потому ничего не
// фильтрует.
//
// Оба признака берутся из существующей модели, нового поля не заводится:
//   • «пройден» — `isCourseComplete`, тот же предикат, на котором стоит
//     `advanceChainIfCourseComplete` (цепь курсов, заход 13.6) и галка «пройден»
//     в каталоге; `listCoursesForStudent` уже отдаёт его результат;
//   • «был доступен с самого начала» — стартовый префикс цепи
//     (`listStartingCourseIds`): ровно те курсы, что открыты ученику БЕЗ строк
//     `course_access`, то есть состояние `open_welcome` у новичка. Признак
//     позиционный, не по слагу: снятие вводного курса с публикации или его
//     переименование правило не ломает.
//
// Второго определения ни «пройденности», ни «стартовой доступности» здесь НЕ
// заводится: их однажды уже разъезжало между `canOpenCourse` и
// `listCourseAccess`, и повторять это нельзя.
//
// Это правило НЕ смешивается с локом за страйки (`computeBookingLock`, spec
// 7.8): у них разные причины и разные тексты, и ученик должен понимать, какая
// из двух его касается. Лок временный и про дисциплину, это условие — про
// готовность; проверяются они независимо.

export interface MockBookingAccess {
  /** Можно ли занимать слот: бронь, перенос, лист ожидания. */
  open: boolean;
  /** Текущий шаг ученика — куда его вести из объяснения. */
  nextCourse: { slug: string; title: string; progressPct: number } | null;
  /** Ближайший курс, прохождение которого откроет бронь (не стартовый). */
  unlockingCourse: { slug: string; title: string } | null;
}

/**
 * Доступ ученика к брони мока. `open === true`, когда пройден хотя бы один курс
 * вне стартового префикса цепи.
 *
 * Курс без обязательных уроков пройденным не считается (правило цепи, заход
 * 13.6) — пустая заглушка бронь не откроет. Если в цепи вообще нет курсов за
 * стартовым префиксом (одна ступень на всю платформу), бронь остаётся закрытой:
 * это вопрос к содержанию программы, а не повод завести здесь тихое исключение.
 */
export async function getMockBookingAccess(db: Db, userId: string): Promise<MockBookingAccess> {
  const [courses, starting] = await Promise.all([
    listCoursesForStudent(db, userId),
    listStartingCourseIds(db),
  ]);
  const earned = (course: { id: string }) => !starting.has(course.id);

  if (courses.some((course) => course.isCompleted && earned(course))) {
    return { open: true, nextCourse: null, unlockingCourse: null };
  }

  // «Начни отсюда» уже указывает на первый открытый незавершённый курс — та же
  // точка, куда ведём ученика отсюда.
  const next =
    courses.find((course) => course.isNext) ??
    courses.find((course) => !course.locked && !course.isCompleted) ??
    null;
  // А это цель: ближайший курс, который бронь реально откроет. Курс без
  // обязательных уроков целью быть не может — закрыть его нечем, и обещать его
  // ученику значит повторить находку аудита 13.6 про «Откроется после {курс}».
  const unlocking =
    courses.find((course) => earned(course) && !course.isCompleted && course.lessonsTotal > 0) ??
    null;
  return {
    open: false,
    nextCourse: next ? { slug: next.slug, title: next.title, progressPct: next.progressPct } : null,
    unlockingCourse: unlocking ? { slug: unlocking.slug, title: unlocking.title } : null,
  };
}

/** Короткая проверка для серверных действий. */
export async function canBookMocks(db: Db, userId: string): Promise<boolean> {
  return (await getMockBookingAccess(db, userId)).open;
}
