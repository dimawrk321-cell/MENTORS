"use server";

import { prisma } from "@/lib/db";
import { markNotificationsRead } from "@/lib/services/notifications";
import {
  assertNotImpersonating,
  requireActionAuth,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// Notifications mutations (spec 9): markRead(ids|all). GET (unread + recent) is
// a Route Handler (/api/notifications/unread) for the bell's polling.

export async function markNotificationsReadAction(
  input: { ids?: string[]; all?: boolean } = {},
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const auth = await requireActionAuth();
    // Impersonation is read-only (spec 7.2) — viewing the bell is fine, marking is not.
    assertNotImpersonating(auth);
    const count = await markNotificationsRead(prisma, auth.user.id, input);
    return { count };
  });
}
