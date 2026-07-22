"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveSecurityFlag } from "@/lib/services/security";
import { adminTerminateSession } from "@/lib/services/admin-security";
import { PULT_CACHE_TAG } from "@/lib/services/admin-dashboard";
import {
  ActionError,
  parseInput,
  requireActionPermission,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// /admin/security actions (spec 13.1/D3) — students.manage. Resolving a flag also
// busts the Пульт cache so the red-flag count updates there too.

const idSchema = z.string().min(1);

/** Terminate one student session (spec 13.1/D3). */
export async function terminateSessionAction(sessionId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("students.manage");
    const res = await adminTerminateSession(prisma, {
      actorId: auth.user.id,
      sessionId: parseInput(idSchema, sessionId),
    });
    if (!res.ok) throw new ActionError(res.code, "Сессия не найдена или уже завершена");
    revalidatePath("/admin/security");
    return undefined;
  });
}

/** Resolve a security flag (spec 13.1/D3); also invalidates the Пульт widget. */
export async function resolveSecurityFlagAction(flagId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("students.manage");
    await resolveSecurityFlag(prisma, {
      flagId: parseInput(idSchema, flagId),
      actorId: auth.user.id,
    });
    revalidatePath("/admin/security");
    revalidatePath("/admin");
    revalidateTag(PULT_CACHE_TAG);
    return undefined;
  });
}
