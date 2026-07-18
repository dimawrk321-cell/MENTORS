"use server";

import { prisma } from "@/lib/db";
import { auditDateBounds, listAuditLog, type AuditRow } from "@/lib/services/audit";
import { requireActionRole, runAction, type ActionResult } from "@/lib/auth/action-helpers";

// Read-only cursor pagination for /admin/audit (spec 8.5, owner-only). The page
// server-renders the first page; the client appends further pages via this action.

export interface LoadMoreAuditInput {
  actorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
  cursor: string;
}

export async function loadMoreAuditAction(
  input: LoadMoreAuditInput,
): Promise<ActionResult<{ rows: AuditRow[]; nextCursor: string | null }>> {
  return runAction(async () => {
    const auth = await requireActionRole("owner");
    return listAuditLog(prisma, {
      actorId: input.actorId || undefined,
      entityType: input.entityType || undefined,
      ...auditDateBounds(input.from, input.to, auth.user.timezone),
      cursor: input.cursor,
    });
  });
}
