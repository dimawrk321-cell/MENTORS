"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { logQuestionOpen } from "@/lib/services/questions";
import { touchRecentItem } from "@/lib/services/recent";
import {
  parseInput,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// Student-facing question actions (spec 7.4). Admin question CRUD lives in
// questions-admin.ts.

/**
 * Logs question.opened (spec 7.13) and bumps the palette recency index (spec
 * 7.11). Fired once on the question page mount. Skipped under impersonation
 * (read-only, spec 7.2) and for expired access.
 */
export async function openQuestionAction(questionId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    if (auth.impersonated || auth.accessExpired) return undefined; // silent no-op
    const id = parseInput(z.string().min(1), questionId);
    await logQuestionOpen(prisma, { userId: auth.user.id, questionId: id });
    await touchRecentItem(prisma, { userId: auth.user.id, itemType: "question", entityId: id });
    return undefined;
  });
}
