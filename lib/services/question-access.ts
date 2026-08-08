import type { Db } from "@/lib/db";
import { isOpen, listCourseAccess } from "@/lib/services/course-access";

// Доступ к банку вопросов через цепь курсов (заход «Банк вопросов», changelog
// к 7.4/8.3). Один источник правды для каталога `/questions`, очереди SRS (7.6)
// и поиска (7.11) — иначе три места разъехались бы, как когда-то разъехались
// canOpenCourse и listCourseAccess.
//
// Правило:
//   • категория (или её предок в дереве) сопоставлена хотя бы одному ОТКРЫТОМУ
//     курсу → видна;
//   • ни она, ни её предки не сопоставлены НИ ОДНОМУ курсу → общий пул, видна
//     всем;
//   • иначе (все курсы её ветки заперты) → не видна вообще, без замков и
//     заглушек — как скрытые разделы справочника (12.1/C3).
//
// Наследование по дереву обязательно: ментор связывает курс с корневой
// категорией («Classic ML»), а вопросы лежат в подкатегориях («Метрики»).
// Без наследования такая связь прятала бы ровно те вопросы, ради которых её и
// заводили.
//
// Персонал (mentor+) сюда не ходит: у него свои экраны банка без фильтра.

export interface QuestionAccess {
  /** Категории, вопросы которых ученик может видеть. */
  categoryIds: Set<string>;
  /** Категории общего пула — ни они, ни их предки не привязаны к курсам. */
  sharedCategoryIds: Set<string>;
  /** Открытые ученику курсы, в порядке цепи. */
  openCourses: { id: string; title: string }[];
}

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
  const [links, categories, access] = await Promise.all([
    db.courseQuestionCategory.findMany({ select: { courseId: true, categoryId: true } }),
    db.questionCategory.findMany({ select: { id: true, parentId: true } }),
    listCourseAccess(db, userId),
  ]);

  const openCourseIds = new Set(access.filter((row) => isOpen(row.state)).map((r) => r.courseId));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const linkedIds = new Set(links.map((l) => l.categoryId));

  // Категория → открыт ли хоть один её курс.
  const openByCategory = new Map<string, boolean>();
  for (const link of links) {
    const already = openByCategory.get(link.categoryId) ?? false;
    openByCategory.set(link.categoryId, already || openCourseIds.has(link.courseId));
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
    if (openByCategory.get(governing) === true) categoryIds.add(category.id);
  }

  return {
    categoryIds,
    sharedCategoryIds,
    openCourses: access
      .filter((row) => isOpen(row.state))
      .map((row) => ({ id: row.courseId, title: row.title })),
  };
}

/**
 * Готовый `where`-фрагмент для запросов по вопросам. Пустое множество тоже
 * фильтр: `categoryId: { in: [] }` честно отдаёт ноль строк — молчаливого
 * «показать всё» здесь быть не должно.
 */
export function categoryFilter(access: QuestionAccess): { categoryId: { in: string[] } } {
  return { categoryId: { in: [...access.categoryIds] } };
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
