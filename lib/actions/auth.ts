"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  acceptInvite,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
} from "@/lib/services/auth";
import { isAccessExpired } from "@/lib/services/sessions";
import {
  clearedCookieOptions,
  deviceCookieOptions,
  DEVICE_COOKIE,
  IMPERSONATION_RETURN_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import { getAuth, homePathFor } from "@/lib/auth/guards";
import {
  ActionError,
  getRequestContext,
  parseInput,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  acceptInviteSchema,
  loginSchema,
  requestResetSchema,
  resetPasswordSchema,
} from "@/lib/utils/validation";

export type AuthFormState = ActionResult<undefined> | null;

function blockedMessage(): string {
  const contact = env.renewalContact ?? "нами";
  return `Аккаунт заблокирован. Свяжись с ${contact}`;
}

async function setAuthCookies(token: string, deviceCookieId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  jar.set(DEVICE_COOKIE, deviceCookieId, deviceCookieOptions());
  // A fresh login always drops a stale impersonation return-point.
  jar.set(IMPERSONATION_RETURN_COOKIE, "", clearedCookieOptions());
}

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let target: string | null = null;

  const result = await runAction<undefined>(async () => {
    const input = parseInput(loginSchema, {
      email: formData.get("email"),
      password: formData.get("password"),
    });
    const ctx = await getRequestContext();
    const jar = await cookies();
    const res = await login(prisma, input, {
      ...ctx,
      deviceCookieId: jar.get(DEVICE_COOKIE)?.value ?? null,
    });
    if (!res.ok) {
      if (res.code === "rate_limited") {
        throw new ActionError(res.code, "Слишком много попыток, подожди 15 минут");
      }
      if (res.code === "blocked") {
        throw new ActionError(res.code, blockedMessage());
      }
      throw new ActionError(res.code, "Неверный email или пароль");
    }
    await setAuthCookies(res.token, res.deviceCookieId);
    target = homePathFor(res.user, isAccessExpired(res.user));
    return undefined;
  });

  if (result.ok && target) redirect(target);
  return result;
}

export async function acceptInviteAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let done = false;

  const result = await runAction<undefined>(async () => {
    const input = parseInput(acceptInviteSchema, {
      token: formData.get("token"),
      password: formData.get("password"),
      consent: formData.get("consent"),
    });
    const ctx = await getRequestContext();
    const jar = await cookies();
    const res = await acceptInvite(
      prisma,
      { token: input.token, password: input.password },
      { ...ctx, deviceCookieId: jar.get(DEVICE_COOKIE)?.value ?? null },
    );
    if (!res.ok) {
      if (res.code === "used") {
        throw new ActionError(res.code, "Инвайт уже использован — войди со своим паролем");
      }
      throw new ActionError(res.code, "Ссылка устарела, попроси новую");
    }
    await setAuthCookies(res.token, res.deviceCookieId);
    done = true;
    return undefined;
  });

  // Spec 8.1: accepted invite → auto-login → onboarding.
  if (result.ok && done) redirect("/onboarding");
  return result;
}

export async function requestResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  return runAction<undefined>(async () => {
    const input = parseInput(requestResetSchema, { email: formData.get("email") });
    const ctx = await getRequestContext();
    const res = await requestPasswordReset(prisma, input, { ip: ctx.ip });
    if (!res.ok) {
      throw new ActionError(res.code, "Слишком много попыток, подожди 15 минут");
    }
    return undefined;
  });
}

export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  let done = false;

  const result = await runAction<undefined>(async () => {
    const input = parseInput(resetPasswordSchema, {
      token: formData.get("token"),
      password: formData.get("password"),
    });
    const res = await resetPassword(prisma, input);
    if (!res.ok) {
      throw new ActionError(res.code, "Ссылка устарела — запроси сброс ещё раз");
    }
    done = true;
    return undefined;
  });

  if (result.ok && done) redirect("/login?reset=1");
  return result;
}

export async function logoutAction(): Promise<void> {
  const auth = await getAuth();
  if (auth.state === "valid") {
    await logout(prisma, auth.session);
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", clearedCookieOptions());
  jar.set(IMPERSONATION_RETURN_COOKIE, "", clearedCookieOptions());
  redirect("/login");
}
