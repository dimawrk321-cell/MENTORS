"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { answerQuizQuestion } from "@/lib/services/questions";
import { answerTestQuestion, finishTestAttempt, startTestAttempt } from "@/lib/services/tests";
import { getCourseView } from "@/lib/services/content";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { toFeedback, type GamificationFeedback } from "@/lib/gamification";

// Student quiz & test actions (spec 7.5). Availability by gating is enforced
// HERE (server-side) via the content service — tests.ts deliberately does not
// import content.ts (content consumes its gating hook), the action layer is
// the meeting point.

const answerSchema = z.union([z.string().max(2000), z.array(z.string().max(100)).max(50)]);

const quizInputSchema = z.object({
  lessonId: z.string().min(1),
  questionId: z.string().min(1),
  answer: answerSchema,
});

export async function answerQuizAction(
  input: unknown,
): Promise<ActionResult<{ correct: boolean; first: boolean; gamification: GamificationFeedback }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(quizInputSchema, input);
    const result = await answerQuizQuestion(prisma, {
      userId: auth.user.id,
      lessonId: parsed.lessonId,
      questionId: parsed.questionId,
      answer: parsed.answer,
    });
    if (!result.ok) throw new ActionError(result.code, "Вопрос не найден в квизе урока");
    return { correct: result.correct, first: result.first, gamification: toFeedback(result) };
  });
}

const startTestSchema = z.object({
  moduleId: z.string().min(1),
  kind: z.enum(["module", "testout"]),
});

/** Проверка доступности по гейтингу + старт/резюм попытки. */
export async function startTestAction(
  input: unknown,
): Promise<ActionResult<{ attemptId: string }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(startTestSchema, input);

    const mod = await prisma.module.findUnique({
      where: { id: parsed.moduleId },
      include: { course: { select: { slug: true, gating: true, status: true } } },
    });
    if (!mod || mod.status !== "published" || mod.course.status !== "published") {
      throw new ActionError("not_found", "Модуль не найден");
    }
    const courseView = await getCourseView(prisma, mod.course.slug, auth.user.id);
    const moduleState = courseView?.state.modules.get(mod.id);
    if (!moduleState) throw new ActionError("not_found", "Модуль не найден");
    const lessonsDone = moduleState.completedRequired === moduleState.totalRequired;

    if (parsed.kind === "module" && !lessonsDone) {
      throw new ActionError("locked", "Сначала заверши уроки модуля");
    }
    if (parsed.kind === "testout") {
      // Spec 7.3: экстерн — на незачтённом strict-модуле, пока обычный тест
      // недоступен (уроки не завершены). Иначе — обычный экзамен.
      if (mod.course.gating !== "strict") {
        throw new ActionError(
          "not_applicable",
          "Экстерн доступен только в курсах со строгим порядком",
        );
      }
      if (lessonsDone) {
        throw new ActionError("not_applicable", "Уроки уже пройдены — сдай обычный модульный тест");
      }
    }

    const result = await startTestAttempt(prisma, {
      userId: auth.user.id,
      moduleId: parsed.moduleId,
      kind: parsed.kind,
    });
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        no_test: "У модуля нет теста",
        disabled: "Тест модуля выключен",
        no_questions: "В модуле пока нет вопросов для теста",
        cooldown: "Пересдача ещё на кулдауне — попробуй позже",
        already_passed: "Тест уже сдан",
      };
      throw new ActionError(result.code, messages[result.code]);
    }
    return { attemptId: result.attemptId };
  });
}

const answerTestSchema = z.object({
  attemptId: z.string().min(1),
  questionId: z.string().min(1),
  answer: answerSchema,
});

export async function answerTestAction(
  input: unknown,
): Promise<ActionResult<{ answered: number; total: number }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(answerTestSchema, input);
    const result = await answerTestQuestion(prisma, {
      userId: auth.user.id,
      attemptId: parsed.attemptId,
      questionId: parsed.questionId,
      answer: parsed.answer,
    });
    if (!result.ok) {
      const messages: Record<typeof result.code, string> = {
        not_found: "Попытка не найдена",
        finished: "Попытка уже завершена",
        foreign_question: "Вопрос не из этой попытки",
        already_answered: "Ответ уже записан",
      };
      throw new ActionError(result.code, messages[result.code]);
    }
    return { answered: result.answered, total: result.total };
  });
}

export async function finishTestAction(attemptId: string): Promise<
  ActionResult<{
    score: number;
    passed: boolean;
    threshold: number;
    gamification: GamificationFeedback;
  }>
> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const result = await finishTestAttempt(prisma, {
      userId: auth.user.id,
      attemptId: parseInput(z.string().min(1), attemptId),
    });
    if (!result.ok) {
      throw new ActionError(
        result.code,
        result.code === "finished" ? "Попытка уже завершена" : "Попытка не найдена",
      );
    }
    return {
      score: result.score,
      passed: result.passed,
      threshold: result.threshold,
      gamification: toFeedback(result),
    };
  });
}
