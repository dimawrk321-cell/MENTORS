import type { Prisma, Question } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  ANSWERED_QUESTION_WHERE,
  getQuestionAccess,
  hasReferenceAnswer,
  questionAccessWhere,
  type QuestionAccess,
} from "@/lib/services/question-access";
import { addSrsCardManually, getLaggingQuestionIds } from "@/lib/services/srs";
import { seededShuffle } from "@/lib/utils/shuffle";
import {
  summarizeFreeTraining,
  type FreeTrainingAnswer,
  type FreeTrainingRoot,
  type FreeTrainingSummary,
} from "@/lib/utils/free-training-summary";

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

/** Вопросы, привязанные к урокам курса, — поимённо (второй уровень доступа). */
async function courseLinkedQuestionIds(db: Db, courseId: string): Promise<string[]> {
  const links = await db.questionLesson.findMany({
    where: { lesson: { module: { courseId } } },
    select: { questionId: true },
  });
  return [...new Set(links.map((link) => link.questionId))];
}

/**
 * `where` набора: пересечение «что в наборе» и «что ученику доступно» (заход
 * «Доступ к вопросам»). Второе — общий `getQuestionAccess`, второй логики
 * доступа здесь нет: для пройденного курса это его категории, для курса в
 * процессе — ключевые вопросы пройденных уроков.
 */
function setWhere(
  access: QuestionAccess,
  scope: { categoryIds?: string[]; questionIds?: string[] },
): Prisma.QuestionWhereInput {
  const inSet: Prisma.QuestionWhereInput[] = [];
  if (scope.categoryIds) inSet.push({ categoryId: { in: scope.categoryIds } });
  if (scope.questionIds) inSet.push({ id: { in: scope.questionIds } });
  return {
    status: "published",
    AND: [ANSWERED_QUESTION_WHERE, questionAccessWhere(access), { OR: inSet }],
  };
}

/** Наборы, доступные ученику: только открытые категории и открытые курсы. */
export async function listFreeTrainingSources(
  db: Db,
  userId: string,
): Promise<FreeTrainingSources> {
  const access = await getQuestionAccess(db, userId);

  // Считаем по РЕАЛЬНО доступным вопросам, а не по открытым категориям: при
  // курсе в процессе доступ поимённый, и счётчик «по категории» обязан это
  // учитывать — обещать 40 вопросов там, где ученику открыты 3, нельзя.
  const [visible, categories, laggingIds] = await Promise.all([
    db.question.findMany({
      where: {
        status: "published",
        AND: [ANSWERED_QUESTION_WHERE, questionAccessWhere(access)],
      },
      select: { id: true, type: true, answerMd: true, categoryId: true },
    }),
    db.questionCategory.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, parentId: true },
    }),
    getLaggingQuestionIds(db, userId),
  ]);

  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  // Наборы показываем по КОРНЯМ: 58 категорий списком — это не выбор, а поиск.
  const roots = categories.filter((c) => c.parentId === null);
  const rootTotals = new Map<string, number>();
  const visibleIds = new Set<string>();
  for (const question of visible) {
    if (!hasReferenceAnswer(question)) continue;
    visibleIds.add(question.id);
    const rootId = parentOf.get(question.categoryId) ?? question.categoryId;
    rootTotals.set(rootId, (rootTotals.get(rootId) ?? 0) + 1);
  }

  const courses = await db.course.findMany({
    where: { id: { in: access.openCourses.map((c) => c.id) }, status: "published" },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true },
  });
  const courseOptions: FreeTrainingOption[] = [];
  for (const course of courses) {
    const total = await db.question.count({
      where: setWhere(access, {
        categoryIds: await courseCategoryIds(db, course.id),
        questionIds: await courseLinkedQuestionIds(db, course.id),
      }),
    });
    if (total > 0) courseOptions.push({ id: course.id, title: course.title, questions: total });
  }

  return {
    categories: roots
      .map((root) => ({ id: root.id, title: root.title, questions: rootTotals.get(root.id) ?? 0 }))
      .filter((option) => option.questions > 0),
    courses: courseOptions,
    lagging: laggingIds.filter((id) => visibleIds.has(id)).length,
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

  // Набор задаёт только СОСТАВ; что из него доступно — решает `setWhere` тем же
  // общим правилом доступа (заход «Доступ к вопросам»).
  const scope: { categoryIds?: string[]; questionIds?: string[] } =
    input.source.kind === "category"
      ? { categoryIds: await categorySubtreeIds(db, input.source.categoryId) }
      : input.source.kind === "course"
        ? {
            categoryIds: await courseCategoryIds(db, input.source.courseId),
            questionIds: await courseLinkedQuestionIds(db, input.source.courseId),
          }
        : { questionIds: await getLaggingQuestionIds(db, input.userId) };

  const questions = (
    await db.question.findMany({
      where: setWhere(access, scope),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
  ).filter(hasReferenceAnswer);

  const shuffled = seededShuffle(questions, input.seed ?? input.userId);
  return input.size === "all" ? shuffled : shuffled.slice(0, input.size);
}

// Типы итога — из общей чистой части, чтобы клиент мог считать его сам.
export type {
  FreeTrainingAnswer,
  FreeTrainingCategoryRow,
  FreeTrainingGrade,
  FreeTrainingRoot,
  FreeTrainingSummary,
} from "@/lib/utils/free-training-summary";

export interface FreeTrainingResult extends FreeTrainingSummary {
  /** Сколько карточек реально завели в повторения этим прогоном. */
  addedToSrs: number;
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
    include: {
      category: { include: { parent: { select: { id: true, title: true, colorIndex: true } } } },
    },
  });
  const rootByQuestion = new Map<string, FreeTrainingRoot>(
    questions.map((question) => {
      const root = question.category.parent ?? question.category;
      return [question.id, { id: root.id, title: root.title, colorIndex: root.colorIndex }];
    }),
  );

  let addedToSrs = 0;
  for (const answer of answers) {
    if (answer.grade === "good") continue;
    // Живую карточку не трогаем: addSrsCardManually поверх неё — no-op.
    const res = await addSrsCardManually(db, {
      userId: input.userId,
      questionId: answer.questionId,
      now: input.now,
    });
    if (res.ok && res.added) addedToSrs += 1;
  }

  return { ...summarizeFreeTraining(answers, rootByQuestion), addedToSrs };
}
