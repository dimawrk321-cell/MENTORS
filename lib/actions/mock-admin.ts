"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { removeStrike, upsertInterviewerProfile } from "@/lib/services/mock-admin";
import { upsertRubricTemplate } from "@/lib/services/feedback";
import { writeAudit } from "@/lib/services/audit";
import {
  ActionError,
  parseInput,
  requireActionRole,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  interviewerProfileSchema,
  removeStrikeSchema,
  rubricTemplateSchema,
} from "@/lib/utils/validation";

// Admin /admin/interviews mutations (spec 8.5): снятие страйка, редактор рубрик,
// редактирование профилей интервьюеров. admin+ (spec 2). Аудит — в сервисах.

function revalidateInterviews(): void {
  revalidatePath("/admin/interviews");
}

export async function removeStrikeAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("admin");
    const parsed = parseInput(removeStrikeSchema, input);
    const res = await removeStrike(prisma, { actorId: auth.user.id, strikeId: parsed.strikeId });
    if (!res.ok) throw new ActionError(res.code, "Страйк не найден");
    revalidateInterviews();
    return undefined;
  });
}

export async function upsertRubricAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("admin");
    const parsed = parseInput(rubricTemplateSchema, input);
    await upsertRubricTemplate(prisma, { type: parsed.type, criteria: parsed.criteria });
    await writeAudit(prisma, {
      actorId: auth.user.id,
      action: "rubric.updated",
      entityType: "rubric_template",
      entityId: parsed.type,
      after: { criteria: parsed.criteria },
    });
    revalidateInterviews();
    return undefined;
  });
}

export async function updateInterviewerProfileAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("admin");
    const parsed = parseInput(interviewerProfileSchema, input);
    const res = await upsertInterviewerProfile(prisma, {
      actorId: auth.user.id,
      userId: parsed.userId,
      roomUrl: parsed.roomUrl,
      bio: parsed.bio ?? null,
      active: parsed.active,
    });
    if (!res.ok) throw new ActionError(res.code, "Это не интервьюер");
    revalidateInterviews();
    return undefined;
  });
}
