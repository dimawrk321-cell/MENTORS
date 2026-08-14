import type { ContentStatus, PrismaClient, QuestionType } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  checkAnswer,
  correctAnswerText,
  parseOptions,
  CLOSED_QUESTION_TYPES,
} from "@/lib/utils/answers";
import { catalogTeaser } from "@/lib/utils/text";
import { renderMarkdownHtml } from "@/lib/utils/markdown";
import { seededShuffle } from "@/lib/utils/shuffle";
import { slugify, uniqueSlug } from "@/lib/utils/slug";
import { emitEvent, type EarnedAchievement } from "@/lib/services/events";
import {
  ANSWERED_QUESTION_WHERE,
  hasReferenceAnswer,
  visibleQuestionWhere,
  type QuestionAccess,
} from "@/lib/services/question-access";
import { addSrsCardForFailure } from "@/lib/services/srs";
import { writeAudit } from "@/lib/services/audit";

// Question bank (spec 7.4): student catalog + lesson quiz/key questions +
// admin CRUD with bulk operations (spec 8.5).

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
  /**
   * Доступ по цепи курсов (заход «Банк вопросов», два уровня — «Доступ к
   * вопросам»). `undefined` — вызов без фильтра (админские экраны банка);
   * пустой доступ — честный ноль строк, а не «показать всё».
   */
  access?: QuestionAccess;
  /** Optional window for the student catalog; omitted in admin/tests that need all rows. */
  offset?: number;
  limit?: number;
}

// --- Grouped catalog (walk 13.5 block 1): categories → collapsible sections ---
// The grouped accordion is the only student catalog surface. It supports a
// question window so a large bank does not mount hundreds of rows at once.

export interface CatalogGroupQuestion {
  id: string;
  /** Строка-тема: полный текст короткого вопроса либо ~80 символов с «…». */
  teaser: string;
  /** Короткий вопрос (текст ≤ 80): строка = полный текст, раскрытие даёт только эталон. */
  isShort: boolean;
  type: QuestionType;
  difficulty: number;
  /** Первый опубликованный привязанный урок — «Открыть урок» (spec 13.5 1.2). */
  lessonId: string | null;
}

export interface CatalogGroup {
  categoryId: string;
  title: string;
  colorIndex: number;
  questions: CatalogGroupQuestion[];
}

/**
 * Grouped catalog (walk 13.5 block 1.1): all matching published questions grouped
 * under their ROOT category, in category `order`. Optional pagination limits the
 * mounted rows; collapsed sections keep each page navigable.
 * A subcategory's questions fold into its parent (root) section.
 *
 * The эталон (answer_md) is NOT loaded here — only a cheap teaser per row. The full
 * question + answer are rendered on demand when a row is expanded (renderCatalogAnswer
 * via the /api/questions/[id]/answer route), so the catalog SSR stays light.
 */
export async function listQuestionsCatalogGrouped(
  db: Db,
  filters: CatalogFilters,
): Promise<{ groups: CatalogGroup[]; total: number }> {
  // Доступ по цепи курсов и явно выбранная категория пересекаются, а не
  // складываются: выбор категории не должен открывать то, что цепь закрыла.
  // Поэтому выбранная категория идёт отдельным условием, а доступ — своим
  // фрагментом (`AND`): у второго уровня доступа фильтр по id, и «сузить до
  // категории» не должно его терять.
  const picked = filters.categoryId ? await categoryFamilyIds(db, filters.categoryId) : null;

  const where: Prisma.QuestionWhereInput = {
    status: "published",
    ...(filters.ids ? { id: { in: filters.ids } } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(picked ? { categoryId: { in: picked } } : {}),
    ...(filters.q ? { textMd: { contains: filters.q, mode: "insensitive" } } : {}),
    // Каталог ученика: доступ по цепи + наличие эталона. Админские экраны банка
    // зовут без `access` — там фильтра нет вовсе.
    ...(filters.access ? visibleQuestionWhere(filters.access) : {}),
  };
  const publishedLesson = {
    status: "published" as const,
    module: { status: "published" as const, course: { status: "published" as const } },
  };
  const [questions, roots] = await Promise.all([
    db.question.findMany({
      where,
      select: {
        id: true,
        textMd: true,
        type: true,
        answerMd: true,
        difficulty: true,
        category: { select: { id: true, parentId: true, title: true, colorIndex: true } },
        lessonLinks: {
          where: { lesson: publishedLesson },
          select: { lessonId: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.questionCategory.findMany({
      where: { parentId: null },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, colorIndex: true },
    }),
  ]);

  const rootMap = new Map(roots.map((root) => [root.id, root]));
  const byGroup = new Map<string, CatalogGroup>();
  // Второй рубеж фильтра эталона (SQL не умеет trim): только на ученическом
  // пути — админские экраны банка обязаны видеть и недописанные вопросы.
  const visible = filters.access ? questions.filter(hasReferenceAnswer) : questions;
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = filters.limit === undefined ? undefined : Math.max(1, filters.limit);
  const pageQuestions = limit === undefined ? visible : visible.slice(offset, offset + limit);
  for (const q of pageQuestions) {
    // Root = the question's category or, for a subcategory, its parent.
    const rootId = q.category.parentId ?? q.category.id;
    const header = rootMap.get(rootId) ?? {
      id: q.category.id,
      title: q.category.title,
      colorIndex: q.category.colorIndex,
    };
    let group = byGroup.get(header.id);
    if (!group) {
      group = {
        categoryId: header.id,
        title: header.title,
        colorIndex: header.colorIndex,
        questions: [],
      };
      byGroup.set(header.id, group);
    }
    const { teaser, isShort } = catalogTeaser(q.textMd);
    group.questions.push({
      id: q.id,
      teaser,
      isShort,
      type: q.type,
      difficulty: q.difficulty,
      lessonId: q.lessonLinks[0]?.lessonId ?? null,
    });
  }

  // Ordered by category order; any orphan groups (missing root) trail after.
  const groups: CatalogGroup[] = [];
  for (const root of roots) {
    const group = byGroup.get(root.id);
    if (group) {
      groups.push(group);
      byGroup.delete(root.id);
    }
  }
  groups.push(...byGroup.values());
  return { groups, total: visible.length };
}

export interface CatalogAnswer {
  /** Full question HTML — only for a LONG question (a short one shows it in the row). */
  questionHtml: string | null;
  /** Эталон HTML: answer_md (KaTeX/Shiki), else closed-question correct answer + разбор. */
  answerHtml: string;
}

/** Escapes the 3 HTML specials for plain-text embedded in the answer markup. */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Lazy answer for a catalog row (walk 13.5): rendered on first expand via the
 * /api/questions/[id]/answer route — never in the catalog SSR (keeps the first
 * catalog load light). Mirrors QuestionAnswerBody: answer_md → rendered HTML, else
 * the closed-question correct answer + разбор. Returns the full question HTML only
 * for a LONG question. null when the question is not published.
 */
export async function renderCatalogAnswer(db: Db, id: string): Promise<CatalogAnswer | null> {
  const q = await db.question.findUnique({
    where: { id },
    select: {
      status: true,
      textMd: true,
      type: true,
      answerMd: true,
      explanationMd: true,
      options: true,
      acceptedAnswers: true,
    },
  });
  if (!q || q.status !== "published") return null;

  const { isShort } = catalogTeaser(q.textMd);
  const questionHtml = isShort ? null : await renderMarkdownHtml(q.textMd);

  let answerHtml: string;
  if (q.answerMd?.trim()) {
    answerHtml = await renderMarkdownHtml(q.answerMd);
  } else {
    const parts: string[] = [];
    const correct = correctAnswerText(q);
    if (correct) {
      parts.push(
        `<p><span class="text-text-2">Правильный ответ: </span>${escapeHtmlText(correct)}</p>`,
      );
    }
    if (q.explanationMd?.trim()) {
      parts.push(await renderMarkdownHtml(q.explanationMd));
    } else if (!correct) {
      // Тупика без выхода быть не должно (заход «Доступ к вопросам», 1.2):
      // честный текст вместо пустого блока.
      parts.push('<p class="text-text-2">Ответ не заполнен.</p>');
    }
    answerHtml = parts.join("");
  }
  return { questionHtml, answerHtml };
}

export async function getQuestionPublic(db: Db, id: string) {
  const question = await db.question.findUnique({
    where: { id },
    include: { category: { include: { parent: { select: { colorIndex: true, title: true } } } } },
  });
  if (!question || question.status !== "published") return null;
  return question;
}

/**
 * Logs a question open (spec 7.13: question.opened — analytics only, no dedup).
 * Wired at stage 8 for the palette «Недавнее» recency signal; it also feeds the
 * rapid-content security flag (spec 7.2), which already counts these events.
 */
export async function logQuestionOpen(
  db: PrismaClient,
  input: { userId: string; questionId: string; now?: Date },
): Promise<void> {
  await emitEvent(
    db,
    "question.opened",
    { questionId: input.questionId },
    {
      userId: input.userId,
      now: input.now,
    },
  );
}

// --- Lesson blocks (spec 7.3/7.5) ---

/**
 * «Ключевые вопросы урока»: is_key links, published questions.
 *
 * Заход «Доступ к вопросам», блок 1: открытый вопрос без эталона сюда тоже не
 * попадает — блок раскрывает эталон, и пустая карточка в нём бессмысленна, а
 * ещё именно эти вопросы заводятся в SRS при завершении урока. Причину, по
 * которой привязка не доехала до ученика (черновик / нет эталона), называет
 * секция «Вопросы урока» в редакторе — по строкам, а не общим счётчиком.
 */
export async function getKeyQuestionsForLesson(db: Db, lessonId: string) {
  const links = await db.questionLesson.findMany({
    where: {
      lessonId,
      isKey: true,
      question: { status: "published", ...ANSWERED_QUESTION_WHERE },
    },
    include: { question: true },
    orderBy: { createdAt: "asc" },
  });
  return links.map((link) => link.question).filter(hasReferenceAnswer);
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
  | {
      ok: true;
      correct: boolean;
      first: boolean;
      /** Геймификация ответа (XP за первый правильный, стрик, достижения). */
      xpAwarded: number;
      leveledUpTo: number | null;
      earnedAchievements: EarnedAchievement[];
    }
  | { ok: false; code: "not_found" };

/** Поштучный ответ квиза (spec 7.5): +5 XP за первый правильный (spec 7.7). */
export async function answerQuizQuestion(
  db: PrismaClient,
  input: { userId: string; lessonId: string; questionId: string; answer: unknown; now?: Date },
): Promise<QuizAnswerResult> {
  const now = input.now ?? new Date();
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

  // Spec 7.13: ответ, его событие (XP/стрик/достижения) и SRS-карточка неверного
  // ответа — одной транзакцией.
  const gamification = await db.$transaction(async (tx) => {
    await tx.quizAnswer.create({
      data: {
        userId: input.userId,
        questionId: input.questionId,
        lessonId: input.lessonId,
        correct,
        first,
        createdAt: now,
      },
    });
    const result = await emitEvent(
      tx,
      "quiz.answered",
      { lessonId: input.lessonId, questionId: input.questionId, correct, first },
      { userId: input.userId, now },
    );
    // Spec 7.5: неверный ответ квиза → карточка в SRS (quiz_fail).
    if (!correct) {
      await addSrsCardForFailure(tx, {
        userId: input.userId,
        questionId: input.questionId,
        source: "quiz_fail",
        now,
      });
    }
    return result;
  });

  return {
    ok: true,
    correct,
    first,
    xpAwarded: gamification.xpAwarded,
    leveledUpTo: gamification.leveledUpTo,
    earnedAchievements: gamification.earnedAchievements,
  };
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

/** The admin-list Prisma filter (shared by the paginated list and select-all-by-filter). */
async function buildAdminQuestionWhere(
  db: Db,
  filters: AdminQuestionFilters,
): Promise<Prisma.QuestionWhereInput> {
  return {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.needsLatex ? { needsLatex: true } : {}),
    ...(filters.categoryId
      ? { categoryId: { in: await categoryFamilyIds(db, filters.categoryId) } }
      : {}),
    ...(filters.q ? { textMd: { contains: filters.q, mode: "insensitive" } } : {}),
  };
}

/** Upper bound on a single bulk operation / select-all-by-filter (spec 13.1/C). */
export const BULK_MAX = 1000;

/** All question ids matching a filter (spec 13.1/C1: «выбрать всё по фильтру»), capped. */
export async function listQuestionIdsForFilter(
  db: Db,
  filters: AdminQuestionFilters,
): Promise<string[]> {
  const where = await buildAdminQuestionWhere(db, filters);
  const rows = await db.question.findMany({
    where,
    select: { id: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: BULK_MAX,
  });
  return rows.map((r) => r.id);
}

export async function listQuestionsAdmin(db: Db, filters: AdminQuestionFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const where = await buildAdminQuestionWhere(db, filters);
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
): Promise<{ ok: true } | { ok: false; code: "not_found" | "not_draft" | "has_student_data" }> {
  const question = await db.question.findUnique({ where: { id: input.questionId } });
  if (!question) return { ok: false, code: "not_found" };
  if (question.status !== "draft") return { ok: false, code: "not_draft" };
  // 13.2 audit: refuse if the question carries student history (SRS cards or quiz
  // answers) — the Cascade FKs would otherwise wipe it via unpublish→delete.
  const where = { questionId: question.id };
  if ((await db.srsCard.count({ where })) > 0 || (await db.quizAnswer.count({ where })) > 0) {
    return { ok: false, code: "has_student_data" };
  }
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

/** Bulk «в черновик» (spec 13.1/C1): unpublishes the published ones, one audit row. */
export async function bulkSetDraft(
  db: PrismaClient,
  input: { actorId: string; questionIds: string[] },
): Promise<{ updated: number }> {
  const result = await db.question.updateMany({
    where: { id: { in: input.questionIds }, status: "published" },
    data: { status: "draft" },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.bulk_unpublished",
    entityType: "question",
    entityId: "bulk",
    after: { requested: input.questionIds.length, unpublished: result.count },
  });
  return { updated: result.count };
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

/**
 * Bulk role change for a lesson's links (walk 13.6, block 3v2).
 *
 * The per-row select is fine for a handful of questions, but the category pass
 * links whole categories at once — marking twelve of them «ключевой» one row at
 * a time is not a workflow. Roles stay mutually exclusive (changelog stage 3):
 * setting «ключевой» clears «в квизе» and vice versa.
 *
 * One audit entry for the batch, not one per question.
 */
export async function bulkSetQuestionLinkRole(
  db: PrismaClient,
  input: {
    actorId: string;
    lessonId: string;
    questionIds: string[];
    role: "key" | "quiz" | "plain";
  },
): Promise<{ updated: number }> {
  if (input.questionIds.length === 0) return { updated: 0 };
  const flags = {
    isKey: input.role === "key",
    inQuiz: input.role === "quiz",
  };
  const result = await db.questionLesson.updateMany({
    where: { lessonId: input.lessonId, questionId: { in: input.questionIds } },
    data: flags,
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "question.links_bulk_role",
    entityType: "lesson",
    entityId: input.lessonId,
    after: { count: result.count, role: input.role, ...flags },
  });
  return { updated: result.count };
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
export async function searchQuestionsForLink(db: Db, q: string, categoryId?: string) {
  // Changelog 13.6: the lesson editor's «+ Добавить вопрос» panel filters by
  // category, so an empty query with a category picked still lists that
  // category's bank (the family — root + children, like the student catalog).
  const categoryFilter = categoryId
    ? { categoryId: { in: await categoryFamilyIds(db, categoryId) } }
    : {};
  return db.question.findMany({
    where: {
      ...(q ? { textMd: { contains: q, mode: "insensitive" } } : {}),
      ...categoryFilter,
    },
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
