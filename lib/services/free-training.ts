import type { Question } from "@prisma/client";
import type { Db } from "@/lib/db";
import { getQuestionAccess } from "@/lib/services/question-access";
import { addSrsCardManually, getLaggingQuestionIds } from "@/lib/services/srs";
import { seededShuffle } from "@/lib/utils/shuffle";

// Свободная тренировка (заход «Банк вопросов», блок B; changelog к 7.6).
//
// Второй режим тренажёра ПОВЕРХ дневной очереди, а не вместо неё:
//   • набор собирается по выбору ученика (категория / курс / «мои западающие»);
//   • правильный ответ НЕ двигает SRS-интервал и не расходует дневную очередь —
//     иначе прогон по любимой теме «съедал» бы честные повторения;
//   • «не знаю» и «сомневаюсь» заводят карточку в SRS, если её там ещё нет
//     (живую карточку не сбрасываем — она уже живёт по своему расписанию);
//   • XP за прогон НЕ начисляется (DECISION: иначе это ферма XP мимо очереди);
//   • день в стрик засчитывается только основной очередью — здесь не эмитим
//     вообще ничего, и это самая надёжная защита.
//
// Доступ — тот же `getQuestionAccess`, что у каталога, очереди и поиска: набор
// не может содержать вопрос из запертой цепью категории.

export const FREE_TRAINING_SIZES = [10, 15, 20] as const;
export type FreeTrainingSize = (typeof FREE_TRAINING_SIZES)[number] | "all";

export type FreeTrainingSource =
  | { kind: "category"; categoryId: string }
  | { kind: "course"; courseId: string }
  | { kind: "lagging" };

export interface FreeTrainingOption {
  id: string;
  title: string;
  questions: number;
}

export interface FreeTrainingSources {
  categories: FreeTrainingOption[];
  courses: FreeTrainingOption[];
  lagging: number;
}

/** Категории вопроса и её предков — набор по корню включает подкатегории. */
async function categorySubtreeIds(db: Db, rootId: string): Promise<string[]> {
  const all = await db.questionCategory.findMany({ select: { id: true, parentId: true } });
  const children = new Map<string, string[]>();
  for (const category of all) {
    if (!category.parentId) continue;
    children.set(category.parentId, [...(children.get(category.parentId) ?? []), category.id]);
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const child of children.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return out;
}

/** Категории вопросов, привязанных к урокам курса — «набор по курсу». */
async function courseCategoryIds(db: Db, courseId: string): Promise<string[]> {
  const links = await db.questionLesson.findMany({
    where: { lesson: { module: { courseId } } },
    select: { question: { select: { categoryId: true } } },
  });
  const direct = new Set(links.map((l) => l.question.categoryId));
  // Плюс категории, назначенные курсу вручную (заход «Банк вопросов», A1): они
  // и есть «вопросы этого курса», даже если привязок вопрос→урок ещё нет.
  const assigned = await db.courseQuestionCategory.findMany({
    where: { courseId },
    select: { categoryId: true },
  });
  const out = new Set(direct);
  for (const link of assigned) {
    for (const id of await categorySubtreeIds(db, link.categoryId)) out.add(id);
  }
  return [...out];
}

/** Наборы, доступные ученику: только открытые категории и открытые курсы. */
export async function listFreeTrainingSources(
  db: Db,
  userId: string,
): Promise<FreeTrainingSources> {
  const access = await getQuestionAccess(db, userId);
  const allowed = [...access.categoryIds];

  const [counts, categories, laggingIds] = await Promise.all([
    db.question.groupBy({
      by: ["categoryId"],
      where: { status: "published", categoryId: { in: allowed } },
      _count: true,
    }),
    db.questionCategory.findMany({
      where: { id: { in: allowed } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, parentId: true },
    }),
    getLaggingQuestionIds(db, userId),
  ]);

  const byCategory = new Map(counts.map((c) => [c.categoryId, c._count]));
  // Наборы показываем по КОРНЯМ: 58 категорий списком — это не выбор, а поиск.
  const roots = categories.filter((c) => c.parentId === null);
  const rootTotals = new Map<string, number>();
  for (const category of categories) {
    const rootId = category.parentId ?? category.id;
    rootTotals.set(rootId, (rootTotals.get(rootId) ?? 0) + (byCategory.get(category.id) ?? 0));
  }

  const courses = await db.course.findMany({
    where: { id: { in: access.openCourses.map((c) => c.id) }, status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true },
  });
  const courseOptions: FreeTrainingOption[] = [];
  for (const course of courses) {
    const ids = (await courseCategoryIds(db, course.id)).filter((id) => access.categoryIds.has(id));
    if (ids.length === 0) continue;
    const total = await db.question.count({
      where: { status: "published", categoryId: { in: ids } },
    });
    if (total > 0) courseOptions.push({ id: course.id, title: course.title, questions: total });
  }

  return {
    categories: roots
      .map((root) => ({ id: root.id, title: root.title, questions: rootTotals.get(root.id) ?? 0 }))
      .filter((option) => option.questions > 0),
    courses: courseOptions,
    lagging: laggingIds.length,
  };
}

/**
 * Сбор набора прогона. Порядок перемешан детерминированно по (userId, набор):
 * два захода подряд не дают одну и ту же последовательность, но и не скачут
 * при обновлении страницы.
 */
export async function buildFreeTrainingSet(
  db: Db,
  input: { userId: string; source: FreeTrainingSource; size: FreeTrainingSize; seed?: string },
): Promise<Question[]> {
  const access = await getQuestionAccess(db, input.userId);
  const allowed = access.categoryIds;

  let categoryIds: string[] | null = null;
  let questionIds: string[] | null = null;

  if (input.source.kind === "category") {
    categoryIds = (await categorySubtreeIds(db, input.source.categoryId)).filter((id) =>
      allowed.has(id),
    );
  } else if (input.source.kind === "course") {
    categoryIds = (await courseCategoryIds(db, input.source.courseId)).filter((id) =>
      allowed.has(id),
    );
  } else {
    questionIds = await getLaggingQuestionIds(db, input.userId);
  }

  const questions = await db.question.findMany({
    where: {
      status: "published",
      categoryId: categoryIds ? { in: categoryIds } : { in: [...allowed] },
      ...(questionIds ? { id: { in: questionIds } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const shuffled = seededShuffle(questions, input.seed ?? input.userId);
  return input.size === "all" ? shuffled : shuffled.slice(0, input.size);
}

export type FreeTrainingGrade = "again" | "hard" | "good";

export interface FreeTrainingAnswer {
  questionId: string;
  grade: FreeTrainingGrade;
}

export interface FreeTrainingResult {
  good: number;
  hard: number;
  again: number;
  /** Сколько карточек реально завели в повторения этим прогоном. */
  addedToSrs: number;
  /** Разбивка по корневым категориям, худшие сверху. */
  byCategory: { categoryId: string; title: string; total: number; missed: number }[];
  /** Вопросы, которые стоит прогнать ещё раз («Повторить слабые»). */
  weakQuestionIds: string[];
}

/**
 * Итог прогона. Единственный побочный эффект — карточки SRS для «не знаю» и
 * «сомневаюсь»; ни XP, ни событий, ни стрика (см. шапку файла).
 */
export async function finishFreeTraining(
  db: Db,
  input: { userId: string; answers: FreeTrainingAnswer[]; now?: Date },
): Promise<FreeTrainingResult> {
  const answers = input.answers;
  const questions = await db.question.findMany({
    where: { id: { in: answers.map((a) => a.questionId) } },
    include: { category: { include: { parent: { select: { id: true, title: true } } } } },
  });
  const byId = new Map(questions.map((q) => [q.id, q]));

  let addedToSrs = 0;
  const weakQuestionIds: string[] = [];
  for (const answer of answers) {
    if (answer.grade === "good") continue;
    weakQuestionIds.push(answer.questionId);
    // Живую карточку не трогаем: addSrsCardManually поверх неё — no-op.
    const res = await addSrsCardManually(db, {
      userId: input.userId,
      questionId: answer.questionId,
      now: input.now,
    });
    if (res.ok && res.added) addedToSrs += 1;
  }

  const groups = new Map<
    string,
    { categoryId: string; title: string; total: number; missed: number }
  >();
  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) continue;
    const root = question.category.parent ?? question.category;
    const group = groups.get(root.id) ?? {
      categoryId: root.id,
      title: root.title,
      total: 0,
      missed: 0,
    };
    group.total += 1;
    if (answer.grade !== "good") group.missed += 1;
    groups.set(root.id, group);
  }

  return {
    good: answers.filter((a) => a.grade === "good").length,
    hard: answers.filter((a) => a.grade === "hard").length,
    again: answers.filter((a) => a.grade === "again").length,
    addedToSrs,
    byCategory: [...groups.values()].sort(
      (a, b) => b.missed - a.missed || b.total - a.total || a.title.localeCompare(b.title),
    ),
    weakQuestionIds,
  };
}
