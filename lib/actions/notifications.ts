"use server";

import { prisma } from "@/lib/db";
import { dismissNotifications, markNotificationsRead } from "@/lib/services/notifications";
import {
  assertNotImpersonating,
  requireActionAuth,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// Notifications mutations (spec 9 + 13.4/4.4): markRead / dismiss (ids|all). GET
// (unread + recent) is a Route Handler (/api/notifications/unread) for the bell.

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

/** «Крестик» / «Очистить» (13.4/4.4): hide notifications from the bell (read + hidden). */
export async function dismissNotificationsAction(
  input: { ids?: string[]; all?: boolean } = {},
): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const auth = await requireActionAuth();
    assertNotImpersonating(auth);
    const count = await dismissNotifications(prisma, auth.user.id, input);
    return { count };
  });
}
