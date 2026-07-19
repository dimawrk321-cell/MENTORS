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
import {
  changePasswordSchema,
  notificationSettingsSchema,
  readingFontSizeSchema,
  themeSchema,
} from "@/lib/utils/validation";

export type ProfileFormState = ActionResult<undefined> | null;

/**
 * Quick theme toggle (spec 12.1/B1). The profile setting (users.theme) is the
 * source of truth; the header/«Ещё» toggle writes it here. Available to every
 * role (the toggle lives in the admin zone too) — no assertActiveAccess (theme is
 * cosmetic, an expired student may still switch it). While impersonating we must
 * not overwrite the viewed student's pref, so the write is blocked; the client
 * applies the DOM/localStorage change locally regardless and ignores this error.
 */
export async function updateThemeAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionAuth();
    assertNotImpersonating(auth);
    const { theme } = parseInput(themeSchema, input);
    await prisma.user.update({ where: { id: auth.user.id }, data: { theme } });
    return undefined;
  });
}

/** Reading font size for lesson/guide prose (spec 12.1/C9), saved to the profile. */
export async function updateReadingFontSizeAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    assertActiveAccess(auth);
    const { size } = parseInput(readingFontSizeSchema, input);
    await prisma.user.update({ where: { id: auth.user.id }, data: { readingFontSize: size } });
    return undefined;
  });
}

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
