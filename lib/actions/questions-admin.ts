"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  bulkLinkToLesson,
  bulkPublish,
  bulkSetCategory,
  createCategory,
  createQuestion,
  deleteQuestion,
  removeQuestionLessonLink,
  searchQuestionsForLink,
  setQuestionStatus,
  updateQuestion,
  upsertQuestionLessonLink,
} from "@/lib/services/questions";
import { upsertModuleTestConfig } from "@/lib/services/tests";
import { renderMarkdownHtml } from "@/lib/utils/markdown";
import {
  ActionError,
  parseInput,
  requireActionRole,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// Admin question bank actions — mentor+ (spec 2). Audit lives in the services.

const idSchema = z.string().min(1);
const titleSchema = z
  .string("Укажи название")
  .trim()
  .min(1, "Укажи название")
  .max(200, "Слишком длинное название");
const questionTypeSchema = z.enum(["open", "single", "multi", "tf", "short_text"]);

const questionDataSchema = z.object({
  questionId: idSchema,
  categoryId: idSchema,
  textMd: z.string().max(50_000),
  answerMd: z.string().max(100_000).nullable(),
  explanationMd: z.string().max(50_000).nullable(),
  options: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        text: z.string().max(1000),
        correct: z.boolean(),
      }),
    )
    .max(12)
    .nullable(),
  acceptedAnswers: z.array(z.string().max(500)).max(50).nullable(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  needsLatex: z.boolean(),
});

function revalidateBank(): void {
  revalidatePath("/admin/questions");
  revalidatePath("/questions");
}

export async function createCategoryAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(
      z.object({ title: titleSchema, parentId: idSchema.nullable().optional() }),
      input,
    );
    const result = await createCategory(prisma, {
      actorId: auth.user.id,
      title: parsed.title,
      parentId: parsed.parentId ?? null,
    });
    if (!result.ok) throw new ActionError(result.code, "Родительская категория не найдена");
    revalidateBank();
    return { id: result.id };
  });
}

export async function createQuestionAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(z.object({ type: questionTypeSchema, categoryId: idSchema }), input);
    const result = await createQuestion(prisma, {
      actorId: auth.user.id,
      type: parsed.type,
      categoryId: parsed.categoryId,
    });
    if (!result.ok) throw new ActionError(result.code, "Категория не найдена");
    revalidateBank();
    return { id: result.id };
  });
}

export async function updateQuestionAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(questionDataSchema, input);
    const result = await updateQuestion(prisma, {
      actorId: auth.user.id,
      questionId: parsed.questionId,
      data: {
        categoryId: parsed.categoryId,
        textMd: parsed.textMd,
        answerMd: parsed.answerMd,
        explanationMd: parsed.explanationMd,
        options: parsed.options,
        acceptedAnswers: parsed.acceptedAnswers,
        difficulty: parsed.difficulty,
        needsLatex: parsed.needsLatex,
      },
    });
    if (!result.ok) {
      throw new ActionError(
        result.code,
        result.code === "category_not_found" ? "Категория не найдена" : "Вопрос не найден",
      );
    }
    revalidateBank();
    return undefined;
  });
}

export async function setQuestionStatusAction(
  questionId: string,
  status: "draft" | "published",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const result = await setQuestionStatus(prisma, {
      actorId: auth.user.id,
      questionId: parseInput(idSchema, questionId),
      status: parseInput(z.enum(["draft", "published"]), status),
    });
    if (!result.ok) {
      if (result.code === "invalid") {
        throw new ActionError("invalid", `Нельзя опубликовать: ${result.problems?.join("; ")}`);
      }
      throw new ActionError(result.code, "Вопрос не найден");
    }
    revalidateBank();
    return undefined;
  });
}

export async function deleteQuestionAction(questionId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const result = await deleteQuestion(prisma, {
      actorId: auth.user.id,
      questionId: parseInput(idSchema, questionId),
    });
    if (!result.ok) {
      throw new ActionError(
        result.code,
        result.code === "not_draft"
          ? "Удалять можно только черновики — сначала сними с публикации"
          : "Вопрос не найден",
      );
    }
    revalidateBank();
    return undefined;
  });
}

// --- Bulk (spec 8.5: массовые операции) ---

const bulkSchema = z.object({
  questionIds: z.array(idSchema).min(1, "Выбери вопросы").max(500),
  op: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("category"), categoryId: idSchema }),
    z.object({ kind: z.literal("publish") }),
    z.object({
      kind: z.literal("link"),
      lessonId: idSchema,
      isKey: z.boolean(),
      inQuiz: z.boolean(),
    }),
  ]),
});

export async function bulkQuestionsAction(
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(bulkSchema, input);

    let message: string;
    if (parsed.op.kind === "category") {
      const result = await bulkSetCategory(prisma, {
        actorId: auth.user.id,
        questionIds: parsed.questionIds,
        categoryId: parsed.op.categoryId,
      });
      if (!result.ok) throw new ActionError(result.code, "Категория не найдена");
      message = `Категория обновлена у ${result.updated}`;
    } else if (parsed.op.kind === "publish") {
      const result = await bulkPublish(prisma, {
        actorId: auth.user.id,
        questionIds: parsed.questionIds,
      });
      message =
        result.skipped > 0
          ? `Опубликовано ${result.published}, пропущено ${result.skipped} (не проходят проверку)`
          : `Опубликовано ${result.published}`;
    } else {
      const result = await bulkLinkToLesson(prisma, {
        actorId: auth.user.id,
        questionIds: parsed.questionIds,
        lessonId: parsed.op.lessonId,
        isKey: parsed.op.isKey,
        inQuiz: parsed.op.inQuiz,
      });
      if (!result.ok) throw new ActionError(result.code, "Урок не найден");
      message = `Привязано к уроку: ${result.linked}`;
    }
    revalidateBank();
    return { message };
  });
}

// --- Links (question editor + lesson editor) ---

const linkSchema = z.object({
  questionId: idSchema,
  lessonId: idSchema,
  isKey: z.boolean(),
  inQuiz: z.boolean(),
});

export async function upsertQuestionLinkAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(linkSchema, input);
    const result = await upsertQuestionLessonLink(prisma, { actorId: auth.user.id, ...parsed });
    if (!result.ok) throw new ActionError(result.code, "Вопрос или урок не найден");
    revalidateBank();
    revalidatePath(`/admin/content/lessons/${parsed.lessonId}`);
    revalidatePath(`/lessons/${parsed.lessonId}`);
    return undefined;
  });
}

export async function removeQuestionLinkAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(z.object({ questionId: idSchema, lessonId: idSchema }), input);
    await removeQuestionLessonLink(prisma, { actorId: auth.user.id, ...parsed });
    revalidateBank();
    revalidatePath(`/admin/content/lessons/${parsed.lessonId}`);
    revalidatePath(`/lessons/${parsed.lessonId}`);
    return undefined;
  });
}

/** Поиск по банку для привязки из редактора урока. */
export async function searchQuestionsAction(
  q: string,
): Promise<ActionResult<Array<{ id: string; textMd: string; category: string; status: string }>>> {
  return runAction(async () => {
    await requireActionRole("mentor");
    const query = parseInput(z.string().max(200), q);
    const items = await searchQuestionsForLink(prisma, query.trim());
    return items.map((item) => ({
      id: item.id,
      textMd: item.textMd,
      category: item.category.title,
      status: item.status,
    }));
  });
}

/** KaTeX/markdown предпросмотр в редакторе вопроса (spec 8.5). */
export async function renderQuestionPreviewAction(
  md: string,
): Promise<ActionResult<{ html: string }>> {
  return runAction(async () => {
    await requireActionRole("mentor");
    const markdown = parseInput(z.string().max(100_000), md);
    return { html: await renderMarkdownHtml(markdown) };
  });
}

// --- Module test config (spec 8.5: настройка module_tests) ---

const moduleTestSchema = z.object({
  moduleId: idSchema,
  // DECISION: schema allows 1–50 (spec's 10–20 is the guideline for the real
  // bank; the demo module has only 3 closed questions).
  poolSize: z.number().int().min(1, "Минимум 1 вопрос").max(50, "Максимум 50 вопросов"),
  threshold: z.number().int().min(1).max(100),
  cooldownMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  enabled: z.boolean(),
});

export async function upsertModuleTestAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(moduleTestSchema, input);
    const result = await upsertModuleTestConfig(prisma, { actorId: auth.user.id, ...parsed });
    if (!result.ok) throw new ActionError(result.code, "Модуль не найден");
    revalidatePath("/admin/content");
    revalidatePath("/courses");
    return undefined;
  });
}
