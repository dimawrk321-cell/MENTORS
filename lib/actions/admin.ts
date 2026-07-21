"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { resolveContentReport } from "@/lib/services/content";
import { PULT_CACHE_TAG } from "@/lib/services/admin-dashboard";
import {
  ActionError,
  requireActionPermission,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// Admin dashboard mutations (spec 8.5). Resolving a content report from the Пульт
// widget is a content-management action (mentor+, spec 2); it invalidates the
// 10-min Пульт cache so the widget updates immediately.

export async function resolveContentReportAction(
  reportId: string,
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await resolveContentReport(prisma, { actorId: auth.user.id, reportId });
    if (!res.ok) throw new ActionError("not_found", "Репорт уже разрешён или не найден");
    revalidateTag(PULT_CACHE_TAG);
    revalidatePath("/admin");
    return undefined;
  });
}
