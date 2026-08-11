import type { Prisma, QuestionType } from "@prisma/client";
import type { Db } from "@/lib/db";
import { isOpen, listCourseAccess } from "@/lib/services/course-access";
import { getCourseCompletion } from "@/lib/services/course-completion";

// Доступ к банку вопросов через цепь курсов (заход «Банк вопросов», уточнён
// заходом «Доступ к вопросам»; changelog к 7.4/7.6/8.3). Один источник правды
// для каталога `/questions`, наборов свободной тренировки, очереди SRS (7.6) и
// поиска (7.11) — иначе четыре места разъехались бы, как когда-то разъехались
// canOpenCourse и listCourseAccess.
//
// Уровней доступа ДВА, и разница между ними — пройден курс или ещё идёт:
//   • курс ПРОЙДЕН (все модули закрыты) → открыта вся связанная с ним категория
//     (и её поддерево);
//   • курс В ПРОЦЕССЕ → категория целиком НЕ открывается; доступны только
//     вопросы, привязанные ролью «ключевой» к уже ПРОЙДЕННЫМ урокам этого курса
//     — поимённо, по id, независимо от их категории;
//   • курс ЗАПЕРТ → ничего;
//   • категория, к которой не привязан НИ ОДИН курс (ни она, ни её предки), —
//     общий пул, видна всем.
// Полного открытого доступа к банку у ученика нет: всё остальное закрыто без
// замков и заглушек — как скрытые разделы справочника (12.1/C3).
//
// Наследование по дереву обязательно: ментор связывает курс с корневой
// категорией («Classic ML»), а вопросы лежат в подкатегориях («Метрики»).
// Без наследования такая связь прятала бы ровно те вопросы, ради которых её и
// заводили.
//
// Персонал (mentor+) сюда не ходит: у него свои экраны банка без фильтра.

export interface QuestionAccess {
  /** Категории, открытые ЦЕЛИКОМ (пройденные курсы + общий пул). */
  categoryIds: Set<string>;
  /** Категории общего пула — ни они, ни их предки не привязаны к курсам. */
  sharedCategoryIds: Set<string>;
  /**
   * Поимённо открытые вопросы: ключевые привязки пройденных уроков открытых
   * курсов. Второй уровень доступа — он работает и тогда, когда категория
   * вопроса ещё закрыта (курс в процессе).
   */
  questionIds: Set<string>;
  /** Открытые ученику курсы, в порядке цепи. */
  openCourses: { id: string; title: string }[];
}

/**
 * Открытый вопрос без эталона — карточка без обратной стороны: показывать
 * нечего, тренировать нечем (заход «Доступ к вопросам», блок 1). Закрытые типы
 * правилом не затронуты: их обратная сторона — верные варианты и разбор.
 */
export function hasReferenceAnswer(question: {
  type: QuestionType;
  answerMd: string | null;
}): boolean {
  return question.type !== "open" || Boolean(question.answerMd?.trim());
}

/**
 * Тот же фильтр на уровне SQL — для выборок, которые нельзя досчитать в памяти
 * (очередь SRS, счётчики каталога).
 *
 * DECISION: эталон «из одних пробелов» SQL-фильтром не ловится (Prisma не умеет
 * trim в условии), поэтому там, где строки всё равно материализуются, поверх
 * идёт `hasReferenceAnswer`. Оставшийся зазор — ровно пробельный эталон в
 * счётчике — закрыт вторым рубежом в интерфейсе («Ответ не заполнен») и
 * отчётом `scripts/report-thin-answers.ts`.
 */
export const ANSWERED_QUESTION_WHERE: Prisma.QuestionWhereInput = {
  OR: [
    { type: { not: "open" } },
    { AND: [{ answerMd: { not: null } }, { answerMd: { not: "" } }] },
  ],
};

interface CategoryNode {
  id: string;
  parentId: string | null;
}

/** Ближайший предок-или-сам, у которого есть привязки к курсам. */
function governingCategory(
  id: string,
  byId: Map<string, CategoryNode>,
  linked: Set<string>,
): string | null {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    if (linked.has(current)) return current;
    current = byId.get(current)?.parentId ?? null;
  }
  return null;
}

export async function getQuestionAccess(db: Db, userId: string): Promise<QuestionAccess> {
  const [links, categories, access, completion] = await Promise.all([
    db.courseQuestionCategory.findMany({ select: { courseId: true, categoryId: true } }),
    db.questionCategory.findMany({ select: { id: true, parentId: true } }),
    listCourseAccess(db, userId),
    getCourseCompletion(db, userId),
  ]);

  const openCourseIds = new Set(access.filter((row) => isOpen(row.state)).map((r) => r.courseId));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const linkedIds = new Set(links.map((l) => l.categoryId));

  // Категория → пройден ли хоть один её курс. Именно ПРОЙДЕН, а не открыт:
  // курс в процессе даёт доступ поимённо (questionIds ниже), а не пачкой.
  const completedByCategory = new Map<string, boolean>();
  for (const link of links) {
    const already = completedByCategory.get(link.categoryId) ?? false;
    completedByCategory.set(
      link.categoryId,
      already || completion.completedCourseIds.has(link.courseId),
    );
  }

  const categoryIds = new Set<string>();
  const sharedCategoryIds = new Set<string>();
  for (const category of categories) {
    const governing = governingCategory(category.id, byId, linkedIds);
    if (governing === null) {
      sharedCategoryIds.add(category.id);
      categoryIds.add(category.id);
      continue;
    }
    if (completedByCategory.get(governing) === true) categoryIds.add(category.id);
  }

  // Второй уровень: ключевые вопросы пройденных уроков ОТКРЫТЫХ курсов. Для
  // пройденного курса они и так внутри его категории — но только если курс с
  // категорией связан; ничего не связавший ментор не должен отбирать у ученика
  // вопросы уроков, которые тот честно прошёл.
  const completedLessonIds: string[] = [];
  for (const courseId of openCourseIds) {
    const done = completion.completedLessonIdsByCourse.get(courseId);
    if (done) completedLessonIds.push(...done);
  }
  const keyLinks =
    completedLessonIds.length === 0
      ? []
      : await db.questionLesson.findMany({
          where: {
            lessonId: { in: completedLessonIds },
            isKey: true,
            question: { status: "published", ...ANSWERED_QUESTION_WHERE },
          },
          select: { questionId: true },
        });

  return {
    categoryIds,
    sharedCategoryIds,
    questionIds: new Set(keyLinks.map((link) => link.questionId)),
    openCourses: access
      .filter((row) => isOpen(row.state))
      .map((row) => ({ id: row.courseId, title: row.title })),
  };
}

/**
 * Готовый `where`-фрагмент для запросов по вопросам: открытая категория ИЛИ
 * поимённо открытый вопрос. Пустые множества тоже фильтр — `{ in: [] }` честно
 * отдаёт ноль строк, молчаливого «показать всё» здесь быть не должно.
 */
export function questionAccessWhere(access: QuestionAccess): Prisma.QuestionWhereInput {
  return {
    OR: [{ categoryId: { in: [...access.categoryIds] } }, { id: { in: [...access.questionIds] } }],
  };
}

/**
 * Полный фильтр «что ученик вообще может увидеть»: доступ по цепи И наличие
 * эталона. Собран через `AND`, а не спредом, — оба фрагмента используют `OR`, и
 * спред в один объект молча потерял бы первый.
 */
export function visibleQuestionWhere(access: QuestionAccess): Prisma.QuestionWhereInput {
  return { AND: [ANSWERED_QUESTION_WHERE, questionAccessWhere(access)] };
}

/** Виден ли конкретный вопрос — тот же предикат, что и `questionAccessWhere`. */
export function isQuestionVisible(
  access: QuestionAccess,
  question: { id: string; categoryId: string },
): boolean {
  return access.categoryIds.has(question.categoryId) || access.questionIds.has(question.id);
}

/**
 * Предзаполнение связи «курс ↔ категории» по УЖЕ существующим привязкам
 * вопрос→урок: категория относится к курсу, если её вопросы привязаны к урокам
 * этого курса. Чистая выборка без записи — пишет скрипт
 * `scripts/prefill-course-categories.ts`, он же печатает отчёт.
 */
export interface PrefillRow {
  courseId: string;
  courseTitle: string;
  categoryId: string;
  categoryTitle: string;
  questions: number;
}

export async function computeCourseCategoryPrefill(db: Db): Promise<PrefillRow[]> {
  const links = await db.questionLesson.findMany({
    select: {
      question: { select: { id: true, category: { select: { id: true, title: true } } } },
      lesson: {
        select: { module: { select: { course: { select: { id: true, title: true } } } } },
      },
    },
  });

  const acc = new Map<string, PrefillRow & { ids: Set<string> }>();
  for (const link of links) {
    const course = link.lesson.module.course;
    const category = link.question.category;
    const key = `${course.id}:${category.id}`;
    const row = acc.get(key) ?? {
      courseId: course.id,
      courseTitle: course.title,
      categoryId: category.id,
      categoryTitle: category.title,
      questions: 0,
      ids: new Set<string>(),
    };
    row.ids.add(link.question.id);
    acc.set(key, row);
  }

  return [...acc.values()]
    .map(({ ids, ...row }) => ({ ...row, questions: ids.size }))
    .sort((a, b) => a.courseTitle.localeCompare(b.courseTitle) || b.questions - a.questions);
}
