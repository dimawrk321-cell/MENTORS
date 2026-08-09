"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { finishFreeTraining, type FreeTrainingResult } from "@/lib/services/free-training";
import {
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// Свободная тренировка (заход «Банк вопросов», блок B). Один экшен на прогон:
// оценки копятся в клиенте и уходят пачкой в конце. Это осознанно НЕ как в
// дневной очереди, где каждый ответ — свой action: там ответ меняет расписание
// и терять его нельзя, здесь же прогон ничего не двигает, пока не закончен, и
// прерванная тренировка честно не оставляет следа.

const answersSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        grade: z.enum(["again", "hard", "good"]),
      }),
    )
    .min(1, "Пустой прогон")
    .max(500),
});

export async function finishFreeTrainingAction(
  input: unknown,
): Promise<ActionResult<FreeTrainingResult>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(answersSchema, input);
    return finishFreeTraining(prisma, { userId: auth.user.id, answers: parsed.answers });
  });
}
