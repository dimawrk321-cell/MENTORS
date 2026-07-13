import type { ContentStatus, PrismaClient, QuestionType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import { checkAnswer, parseOptions, CLOSED_QUESTION_TYPES } from "@/lib/utils/answers";
import { seededShuffle } from "@/lib/utils/shuffle";
import { slugify, uniqueSlug } from "@/lib/utils/slug";
import { emitEvent } from "@/lib/services/events";
import { addSrsCardForFailure } from "@/lib/services/srs";
import { writeAudit } from "@/lib/services/audit";

// Question bank (spec 7.4): student catalog + lesson quiz/key questions +
// admin CRUD with bulk operations (spec 8.5).

export const CATALOG_PAGE_SIZE = 24;
export const ADMIN_PAGE_SIZE = 50;
export const QUIZ_MAX_QUESTIONS = 7;

// --- Categories ---

export async function listCategoriesTree(db: Db) {
  const categories = await db.questionCategory.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const roots = categories.filter((category) => category.parentId === null);
  return roots.map((root) => ({
    ...root,
    children: categories.filter((category) => category.parentId === root.id),
  }));
}

export async function createCategory(
  db: PrismaClient,
  input: { actorId: string; title: string; parentId?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; code: "parent_not_found" }> {
  const parent = input.parentId
    ? await db.questionCategory.findUnique({ where: { id: input.parentId } })
    : null;
  if (input.parentId && !parent) return { ok: false, code: "parent_not_found" };

  const slug = await uniqueSlug(
    slugify(input.title),
    async (candidate) =>
      (await db.questionCategory.findUnique({ where: { slug: candidate } })) !== null,
  );
  const siblings = await db.questionCategory.count({
    where: { parentId: input.parentId ?? null },
  });
  // Spec 7.4: root colors assigned in order (8 muted pairs, spec 5.1);
  // DECISION: subcategories inherit the parent's color.
  const colorIndex = parent ? parent.colorIndex : siblings % 8;

  const category = await db.questionCategory.create({
    data: {
      title: input.title,
      slug,
      parentId: input.parentId ?? null,
      colorIndex,
      order: siblings,
    },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question_category.created",
    entityType: "question_category",
    entityId: category.id,
    after: { title: input.title, parentId: input.parentId ?? null },
  });
  return { ok: true, id: category.id };
}

/** Ids of a category and its children — filters cover subcategories. */
async function categoryFamilyIds(db: Db, categoryId: string): Promise<string[]> {
  const children = await db.questionCategory.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  return [categoryId, ...children.map((child) => child.id)];
}

// --- Student catalog (spec 7.4) ---

export interface CatalogFilters {
  q?: string;
  categoryId?: string;
  type?: QuestionType;
  difficulty?: 1 | 2 | 3;
  /** «Мои западающие» (этап 4): ограничение выборки по id карточек SRS. */
  ids?: string[];
  page?: number;
}

export async function listQuestionsCatalog(db: Db, filters: CatalogFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.QuestionWhereInput = {
    status: "published",
    ...(filters.ids ? { id: { in: filters.ids } } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.categoryId
      ? { categoryId: { in: await categoryFamilyIds(db, filters.categoryId) } }
      : {}),
    // DECISION: substring match over the question text until stage-8 FTS.
    ...(filters.q ? { textMd: { contains: filters.q, mode: "insensitive" } } : {}),
  };
  const [items, total] = await Promise.all([
    db.question.findMany({
      where,
      include: { category: { include: { parent: { select: { colorIndex: true } } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * CATALOG_PAGE_SIZE,
      take: CATALOG_PAGE_SIZE,
    }),
    db.question.count({ where }),
  ]);
  return { items, total, page, pageSize: CATALOG_PAGE_SIZE };
}

export async function getQuestionPublic(db: Db, id: string) {
  const question = await db.question.findUnique({
    where: { id },
    include: { category: { include: { parent: { select: { colorIndex: true, title: true } } } } },
  });
  if (!question || question.status !== "published") return null;
  return question;
}

// --- Lesson blocks (spec 7.3/7.5) ---

/** «Ключевые вопросы урока»: is_key links, published questions. */
export async function getKeyQuestionsForLesson(db: Db, lessonId: string) {
  const links = await db.questionLesson.findMany({
    where: { lessonId, isKey: true, question: { status: "published" } },
    include: { question: true },
    orderBy: { createdAt: "asc" },
  });
  return links.map((link) => link.question);
}

/**
 * Quiz selection (spec 7.5): in_quiz closed questions, max 7 — при избытке
 * случайные. DECISION: детерминированный шаффл по (userId, lessonId) — выборка
 * случайна между учениками, но стабильна между визитами одного ученика.
 */
export async function getQuizQuestionsForLesson(
  db: Db,
  input: { lessonId: string; userId: string },
) {
  const links = await db.questionLesson.findMany({
    where: {
      lessonId: input.lessonId,
      inQuiz: true,
      question: { status: "published", type: { in: [...CLOSED_QUESTION_TYPES] } },
    },
    include: { question: true },
    orderBy: { createdAt: "asc" },
  });
  const questions = links.map((link) => link.question);
  return seededShuffle(questions, `${input.userId}:${input.lessonId}`).slice(0, QUIZ_MAX_QUESTIONS);
}

export type QuizAnswerResult =
  { ok: true; correct: boolean; first: boolean } | { ok: false; code: "not_found" };

/** Поштучный ответ квиза (spec 7.5): first фиксируется для XP этапа 5. */
export async function answerQuizQuestion(
  db: Db,
  input: { userId: string; lessonId: string; questionId: string; answer: unknown; now?: Date },
): Promise<QuizAnswerResult> {
  const link = await db.questionLesson.findUnique({
    where: { questionId_lessonId: { questionId: input.questionId, lessonId: input.lessonId } },
    include: { question: true },
  });
  if (!link || !link.inQuiz || link.question.status !== "published") {
    return { ok: false, code: "not_found" };
  }

  const correct = checkAnswer(link.question, input.answer);
  // «Первый правильный ответ на вопрос» — разово на (user, question).
  const hadFirst =
    correct &&
    (await db.quizAnswer.count({
      where: { userId: input.userId, questionId: input.questionId, first: true },
    })) > 0;
  const first = correct && !hadFirst;

  await db.quizAnswer.create({
    data: {
      userId: input.userId,
      questionId: input.questionId,
      lessonId: input.lessonId,
      correct,
      first,
      createdAt: input.now ?? new Date(),
    },
  });
  await emitEvent(
    db,
    "quiz.answered",
    { lessonId: input.lessonId, questionId: input.questionId, correct, first },
    { userId: input.userId },
  );
  // Spec 7.5: неверный ответ квиза → карточка в SRS (quiz_fail).
  if (!correct) {
    await addSrsCardForFailure(db, {
      userId: input.userId,
      questionId: input.questionId,
      source: "quiz_fail",
      now: input.now,
    });
  }
  return { ok: true, correct, first };
}

// --- Admin bank (spec 8.5) ---

export interface AdminQuestionFilters {
  q?: string;
  categoryId?: string;
  type?: QuestionType;
  status?: ContentStatus;
  needsLatex?: boolean;
  page?: number;
}

export async function listQuestionsAdmin(db: Db, filters: AdminQuestionFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const where: Prisma.QuestionWhereInput = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.needsLatex ? { needsLatex: true } : {}),
    ...(filters.categoryId
      ? { categoryId: { in: await categoryFamilyIds(db, filters.categoryId) } }
      : {}),
    ...(filters.q ? { textMd: { contains: filters.q, mode: "insensitive" } } : {}),
  };
  const [items, total] = await Promise.all([
    db.question.findMany({
      where,
      include: { category: true, _count: { select: { lessonLinks: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
    }),
    db.question.count({ where }),
  ]);
  return { items, total, page, pageSize: ADMIN_PAGE_SIZE };
}

export async function createQuestion(
  db: PrismaClient,
  input: { actorId: string; type: QuestionType; categoryId: string },
): Promise<{ ok: true; id: string } | { ok: false; code: "category_not_found" }> {
  const category = await db.questionCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) return { ok: false, code: "category_not_found" };
  const question = await db.question.create({
    data: {
      type: input.type,
      categoryId: category.id,
      textMd: "",
      // tf получает фиксированную пару вариантов сразу.
      options:
        input.type === "tf"
          ? [
              { id: "true", text: "Верно", correct: true },
              { id: "false", text: "Неверно", correct: false },
            ]
          : Prisma.JsonNull,
    },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.created",
    entityType: "question",
    entityId: question.id,
    after: { type: input.type, categoryId: category.id },
  });
  return { ok: true, id: question.id };
}

export interface QuestionData {
  categoryId: string;
  textMd: string;
  answerMd: string | null;
  explanationMd: string | null;
  options: Array<{ id: string; text: string; correct: boolean }> | null;
  acceptedAnswers: string[] | null;
  difficulty: number;
  needsLatex: boolean;
}

export async function updateQuestion(
  db: PrismaClient,
  input: { actorId: string; questionId: string; data: QuestionData },
): Promise<{ ok: true } | { ok: false; code: "not_found" | "category_not_found" }> {
  const question = await db.question.findUnique({ where: { id: input.questionId } });
  if (!question) return { ok: false, code: "not_found" };
  const category = await db.questionCategory.findUnique({ where: { id: input.data.categoryId } });
  if (!category) return { ok: false, code: "category_not_found" };

  await db.question.update({
    where: { id: question.id },
    data: {
      categoryId: input.data.categoryId,
      textMd: input.data.textMd,
      answerMd: input.data.answerMd,
      explanationMd: input.data.explanationMd,
      options: input.data.options === null ? Prisma.JsonNull : input.data.options,
      acceptedAnswers:
        input.data.acceptedAnswers === null ? Prisma.JsonNull : input.data.acceptedAnswers,
      difficulty: input.data.difficulty,
      needsLatex: input.data.needsLatex,
    },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.updated",
    entityType: "question",
    entityId: question.id,
    before: { textMd: question.textMd, categoryId: question.categoryId },
    after: { textMd: input.data.textMd, categoryId: input.data.categoryId },
  });
  return { ok: true };
}

/** Publish validation — the bank must not ship broken auto-checked questions. */
export function validateQuestionForPublish(question: {
  type: QuestionType;
  textMd: string;
  answerMd: string | null;
  options: unknown;
  acceptedAnswers: unknown;
}): string[] {
  const problems: string[] = [];
  if (!question.textMd.trim()) problems.push("Пустой текст вопроса");
  const options = parseOptions(question.options);
  switch (question.type) {
    case "open":
      if (!question.answerMd?.trim()) problems.push("У открытого вопроса нет эталонного ответа");
      break;
    case "single":
      if (options.length < 2) problems.push("Нужно минимум два варианта");
      if (options.filter((option) => option.correct).length !== 1)
        problems.push("Ровно один вариант должен быть правильным");
      break;
    case "multi":
      if (options.length < 2) problems.push("Нужно минимум два варианта");
      if (options.filter((option) => option.correct).length < 1)
        problems.push("Отметь хотя бы один правильный вариант");
      break;
    case "tf":
      if (options.length !== 2) problems.push("У «верно/неверно» должно быть два варианта");
      if (options.filter((option) => option.correct).length !== 1)
        problems.push("Ровно один вариант должен быть правильным");
      break;
    case "short_text": {
      const accepted = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers : [];
      if (accepted.length === 0) problems.push("Добавь хотя бы один принимаемый ответ");
      break;
    }
  }
  if (
    options.some((option) => !option.text.trim()) &&
    question.type !== "open" &&
    question.type !== "short_text"
  ) {
    problems.push("Есть пустые варианты ответа");
  }
  return problems;
}

export async function setQuestionStatus(
  db: PrismaClient,
  input: { actorId: string; questionId: string; status: ContentStatus },
): Promise<{ ok: true } | { ok: false; code: "not_found" | "invalid"; problems?: string[] }> {
  const question = await db.question.findUnique({ where: { id: input.questionId } });
  if (!question) return { ok: false, code: "not_found" };
  if (input.status === "published") {
    const problems = validateQuestionForPublish(question);
    if (problems.length > 0) return { ok: false, code: "invalid", problems };
  }
  await db.question.update({ where: { id: question.id }, data: { status: input.status } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: input.status === "published" ? "question.published" : "question.unpublished",
    entityType: "question",
    entityId: question.id,
    before: { status: question.status },
    after: { status: input.status },
  });
  return { ok: true };
}

/** DECISION: draft-only deletion, consistent with the content studio. */
export async function deleteQuestion(
  db: PrismaClient,
  input: { actorId: string; questionId: string },
): Promise<{ ok: true } | { ok: false; code: "not_found" | "not_draft" }> {
  const question = await db.question.findUnique({ where: { id: input.questionId } });
  if (!question) return { ok: false, code: "not_found" };
  if (question.status !== "draft") return { ok: false, code: "not_draft" };
  await db.question.delete({ where: { id: question.id } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.deleted",
    entityType: "question",
    entityId: question.id,
  });
  return { ok: true };
}

// --- Bulk operations (spec 8.5) ---

export async function bulkSetCategory(
  db: PrismaClient,
  input: { actorId: string; questionIds: string[]; categoryId: string },
): Promise<{ ok: true; updated: number } | { ok: false; code: "category_not_found" }> {
  const category = await db.questionCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) return { ok: false, code: "category_not_found" };
  const result = await db.question.updateMany({
    where: { id: { in: input.questionIds } },
    data: { categoryId: category.id },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.bulk_category",
    entityType: "question_category",
    entityId: category.id,
    after: { questionIds: input.questionIds },
  });
  return { ok: true, updated: result.count };
}

/** Публикует валидные, возвращает счётчики (spec 8.5 массовые операции). */
export async function bulkPublish(
  db: PrismaClient,
  input: { actorId: string; questionIds: string[] },
): Promise<{ published: number; skipped: number }> {
  const questions = await db.question.findMany({
    where: { id: { in: input.questionIds }, status: "draft" },
  });
  let published = 0;
  for (const question of questions) {
    if (validateQuestionForPublish(question).length > 0) continue;
    await db.question.update({ where: { id: question.id }, data: { status: "published" } });
    published += 1;
  }
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.bulk_published",
    entityType: "question",
    entityId: "bulk",
    after: { requested: input.questionIds.length, published },
  });
  return { published, skipped: input.questionIds.length - published };
}

export async function bulkLinkToLesson(
  db: PrismaClient,
  input: {
    actorId: string;
    questionIds: string[];
    lessonId: string;
    isKey: boolean;
    inQuiz: boolean;
  },
): Promise<{ ok: true; linked: number } | { ok: false; code: "lesson_not_found" }> {
  const lesson = await db.lesson.findUnique({ where: { id: input.lessonId } });
  if (!lesson) return { ok: false, code: "lesson_not_found" };
  for (const questionId of input.questionIds) {
    await db.questionLesson.upsert({
      where: { questionId_lessonId: { questionId, lessonId: lesson.id } },
      create: { questionId, lessonId: lesson.id, isKey: input.isKey, inQuiz: input.inQuiz },
      update: { isKey: input.isKey, inQuiz: input.inQuiz },
    });
  }
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.bulk_linked",
    entityType: "lesson",
    entityId: lesson.id,
    after: { questionIds: input.questionIds, isKey: input.isKey, inQuiz: input.inQuiz },
  });
  return { ok: true, linked: input.questionIds.length };
}

// --- Links (question editor + lesson editor) ---

export async function upsertQuestionLessonLink(
  db: PrismaClient,
  input: {
    actorId: string;
    questionId: string;
    lessonId: string;
    isKey: boolean;
    inQuiz: boolean;
  },
): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  const [question, lesson] = await Promise.all([
    db.question.findUnique({ where: { id: input.questionId } }),
    db.lesson.findUnique({ where: { id: input.lessonId } }),
  ]);
  if (!question || !lesson) return { ok: false, code: "not_found" };
  await db.questionLesson.upsert({
    where: { questionId_lessonId: { questionId: question.id, lessonId: lesson.id } },
    create: {
      questionId: question.id,
      lessonId: lesson.id,
      isKey: input.isKey,
      inQuiz: input.inQuiz,
    },
    update: { isKey: input.isKey, inQuiz: input.inQuiz },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.linked",
    entityType: "lesson",
    entityId: lesson.id,
    after: { questionId: question.id, isKey: input.isKey, inQuiz: input.inQuiz },
  });
  return { ok: true };
}

export async function removeQuestionLessonLink(
  db: PrismaClient,
  input: { actorId: string; questionId: string; lessonId: string },
): Promise<void> {
  await db.questionLesson.deleteMany({
    where: { questionId: input.questionId, lessonId: input.lessonId },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.unlinked",
    entityType: "lesson",
    entityId: input.lessonId,
    after: { questionId: input.questionId },
  });
}

/** Привязки урока для секции в редакторе урока (любые статусы). */
export async function listLessonQuestionLinks(db: Db, lessonId: string) {
  return db.questionLesson.findMany({
    where: { lessonId },
    include: { question: { include: { category: { select: { title: true } } } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Поиск по банку для привязки (spec 8.5: поиск по банку из редактора урока). */
export async function searchQuestionsForLink(db: Db, q: string) {
  return db.question.findMany({
    where: q ? { textMd: { contains: q, mode: "insensitive" } } : {},
    include: { category: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

/** Уроки для диалога привязки (подписаны курсом и модулем). */
export async function listLessonsForLinking(db: Db) {
  const lessons = await db.lesson.findMany({
    include: {
      module: { select: { title: true, course: { select: { title: true } } } },
    },
    orderBy: [{ createdAt: "asc" }],
    take: 300,
  });
  return lessons.map((lesson) => ({
    id: lesson.id,
    label: `${lesson.module.course.title} · ${lesson.module.title} · ${lesson.title}`,
  }));
}
