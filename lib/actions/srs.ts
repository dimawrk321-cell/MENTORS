"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { addSrsCardManually, reviewSrsCard } from "@/lib/services/srs";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { reviewCardSchema } from "@/lib/utils/validation";
import { toFeedback, type GamificationFeedback } from "@/lib/gamification";

// SRS actions (spec 9): reviewCard(cardId, grade) + addToSrs(questionId).

export async function reviewCardAction(
  input: unknown,
): Promise<
  ActionResult<{ remaining: number; queueCompleted: boolean; gamification: GamificationFeedback }>
> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(reviewCardSchema, input);
    const result = await reviewSrsCard(prisma, {
      userId: auth.user.id,
      cardId: parsed.cardId,
      grade: parsed.grade,
    });
    if (!result.ok) {
      throw new ActionError(
        result.code,
        result.code === "not_due"
          ? "Карточка уже отвечена — продолжай со следующей"
          : "Карточка не найдена",
      );
    }
    return {
      remaining: result.remaining,
      queueCompleted: result.queueCompleted,
      gamification: toFeedback(result),
    };
  });
}

export async function addToSrsAction(
  questionId: string,
): Promise<ActionResult<{ added: boolean }>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const result = await addSrsCardManually(prisma, {
      userId: auth.user.id,
      questionId: parseInput(z.string().min(1), questionId),
    });
    if (!result.ok) throw new ActionError(result.code, "Вопрос не найден");
    return { added: result.added };
  });
}
