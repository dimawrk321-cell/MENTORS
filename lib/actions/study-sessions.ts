"use server";

import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionStudent,
  runAction,
} from "@/lib/auth/action-helpers";
import {
  createStudySession,
  studyCommandSchema,
  StudySessionError,
  updateStudySession,
} from "@/lib/services/study-sessions";

async function guarded<T>(fn: (userId: string) => Promise<T>) {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    try {
      return await fn(auth.user.id);
    } catch (error) {
      if (error instanceof StudySessionError) throw new ActionError(error.code, error.message);
      throw error;
    }
  });
}
export async function createStudySessionAction(input: unknown) {
  return guarded(async (userId) => {
    const data = parseInput(z.object({ lessonId: z.string().max(100).nullable() }).strict(), input);
    const card = await createStudySession(prisma, userId, data.lessonId);
    revalidatePath("/study-sessions");
    return card;
  });
}
export async function updateStudySessionAction(input: unknown) {
  return guarded(async (userId) => {
    const data = parseInput(studyCommandSchema, input);
    const card = await updateStudySession(prisma, userId, data);
    if (data.operation !== "save" || card.status === "completed") {
      revalidateTag("admin-pult");
      revalidatePath("/");
      revalidatePath(`/admin/students/${userId}`);
      revalidatePath("/study-sessions");
    }
    return card;
  });
}
