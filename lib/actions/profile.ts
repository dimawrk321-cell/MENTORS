"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { changePassword } from "@/lib/services/auth";
import { revokeSessions } from "@/lib/services/sessions";
import { updateNotificationPrefs } from "@/lib/services/notifications";
import {
  ActionError,
  assertActiveAccess,
  assertNotImpersonating,
  parseInput,
  requireActionAuth,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { changePasswordSchema, notificationSettingsSchema } from "@/lib/utils/validation";

export type ProfileFormState = ActionResult<undefined> | null;

export async function changePasswordAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  return runAction<undefined>(async () => {
    const auth = await requireActionAuth();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const input = parseInput(changePasswordSchema, {
      oldPassword: formData.get("oldPassword"),
      newPassword: formData.get("newPassword"),
    });
    const res = await changePassword(prisma, {
      user: auth.user,
      currentSessionId: auth.session.id,
      oldPassword: input.oldPassword,
      newPassword: input.newPassword,
    });
    if (!res.ok) {
      throw new ActionError(res.code, "Неверный текущий пароль");
    }
    return undefined;
  });
}

/**
 * Notification settings (spec 7.12/8.3): digest time, quiet hours, and the
 * toggleable channel matrix. Only toggleable channels are honored server-side —
 * «всегда»-типы ignore the submitted matrix (updateNotificationPrefs clamps).
 */
export async function updateNotificationSettingsAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const parsed = parseInput(notificationSettingsSchema, input);
    await prisma.user.update({
      where: { id: auth.user.id },
      data: {
        digestTime: parsed.digestTime,
        quietHoursStart: parsed.quietHoursStart,
        quietHoursEnd: parsed.quietHoursEnd,
      },
    });
    await updateNotificationPrefs(prisma, auth.user.id, parsed.prefs);
    revalidatePath("/profile");
    return undefined;
  });
}

/**
 * «Выйти на всех остальных» (spec 7.2 / 8.3): revokes every session except the
 * one that pressed the button — a safety action must not sign out its author.
 */
export async function revokeOtherSessionsAction(): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionAuth();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    await revokeSessions(prisma, {
      userId: auth.user.id,
      reason: "logout_all",
      exceptSessionId: auth.session.id,
    });
    return undefined;
  });
}
