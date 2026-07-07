"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { changePassword } from "@/lib/services/auth";
import { revokeSessions } from "@/lib/services/sessions";
import { clearedCookieOptions, SESSION_COOKIE } from "@/lib/auth/cookies";
import {
  ActionError,
  assertNotImpersonating,
  parseInput,
  requireActionAuth,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { changePasswordSchema } from "@/lib/utils/validation";

export type ProfileFormState = ActionResult<undefined> | null;

export async function changePasswordAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  return runAction<undefined>(async () => {
    const auth = await requireActionAuth();
    assertNotImpersonating(auth);
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
 * «Выйти на всех» (spec 7.2 / 8.3).
 * DECISION: revokes every session including the current one — the literal
 * reading; the user re-signs in once, which is the honest outcome of the button.
 */
export async function revokeAllSessionsAction(): Promise<ActionResult<undefined>> {
  const result = await runAction<undefined>(async () => {
    const auth = await requireActionAuth();
    assertNotImpersonating(auth);
    await revokeSessions(prisma, { userId: auth.user.id, reason: "logout_all" });
    const jar = await cookies();
    jar.set(SESSION_COOKIE, "", clearedCookieOptions());
    return undefined;
  });
  if (result.ok) redirect("/login");
  return result;
}
