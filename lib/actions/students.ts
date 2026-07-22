"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  adminResetSessions,
  blockStudent,
  buildCredentialMessage,
  bulkExtendAccess,
  bulkGrantFreeze,
  changeStudentEmail,
  createStudentCredentials,
  extendAccess,
  grantFreeze,
  unblockStudent,
} from "@/lib/services/access";
import { adminResetPasswordToTemp } from "@/lib/services/auth";
import {
  startImpersonation,
  stopImpersonation,
  validateSessionToken,
} from "@/lib/services/sessions";
import { setSectionAccess } from "@/lib/services/library";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import {
  clearedCookieOptions,
  IMPERSONATION_RETURN_COOKIE,
  impersonationCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/cookies";
import { getAuth } from "@/lib/auth/guards";
import {
  ActionError,
  getRequestContext,
  parseInput,
  requireActionOwner,
  requireActionPermission,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  emailSchema,
  extendAccessSchema,
  issueCredentialsSchema,
  sectionAccessSchema,
} from "@/lib/utils/validation";
import { formatDateRu } from "@/lib/utils/dates";

// Admin student management (spec 2/8.5, walk 12.4): gated by the `students.manage`
// permission (owner passes). Every mutation is audited inside the services.

function revalidateStudent(userId?: string): void {
  revalidatePath("/admin/students");
  if (userId) revalidatePath(`/admin/students/${userId}`);
}

/** One-time credential reveal (walk 12.4/A1): shown once, never re-fetchable. */
export interface CredentialsIssued {
  userId: string;
  email: string;
  tempPassword: string;
  message: string;
}

export type CredentialsFormState = ActionResult<CredentialsIssued> | null;

/**
 * «Выдать доступ» (walk 12.4/A1): creates a student account with a temporary
 * password and returns it once (login + password + a ready-to-send message).
 */
export async function issueStudentCredentialsAction(
  _prev: CredentialsFormState,
  formData: FormData,
): Promise<CredentialsFormState> {
  return runAction<CredentialsIssued>(async () => {
    const auth = await requireActionPermission("students.manage");
    const input = parseInput(issueCredentialsSchema, {
      email: formData.get("email"),
      name: formData.get("name"),
    });
    const res = await createStudentCredentials(prisma, {
      actorId: auth.user.id,
      email: input.email,
      name: input.name,
    });
    if (!res.ok) {
      throw new ActionError(res.code, "Пользователь с таким email уже существует");
    }
    revalidateStudent(res.userId);
    return {
      userId: res.userId,
      email: input.email,
      tempPassword: res.tempPassword,
      message: buildCredentialMessage(input.email, res.tempPassword),
    };
  });
}

/**
 * «Сбросить пароль» (walk 12.4/A2): resets to a fresh temporary password and
 * reveals it once (same pattern as issuing). The link-based reset is retired
 * from the admin UI (kept only for self-serve «Забыл пароль»).
 */
export async function resetStudentPasswordAction(
  userId: string,
): Promise<ActionResult<{ tempPassword: string; message: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("students.manage");
    // No more than one reset per student per minute.
    if (isApiRateLimited(`reset-pwd:${userId}`, 1, 60_000)) {
      throw new ActionError("rate_limited", "Сбрасывать пароль можно не чаще раза в минуту");
    }
    const res = await adminResetPasswordToTemp(prisma, { actorId: auth.user.id, userId });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "not_eligible"
          ? "Сброс доступен ученику с паролем и не заблокированному"
          : "Ученик не найден",
      );
    }
    revalidateStudent(userId);
    return {
      tempPassword: res.tempPassword,
      message: buildCredentialMessage(res.email, res.tempPassword),
    };
  });
}

export async function extendAccessAction(
  input: unknown,
): Promise<ActionResult<{ newAccessUntilText: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("students.manage");
    const parsed = parseInput(extendAccessSchema, input);
    const res = await extendAccess(prisma, {
      actorId: auth.user.id,
      userId: parsed.userId,
      term:
        parsed.kind === "days"
          ? { kind: "days", days: parsed.days }
          : { kind: "until", date: parsed.date },
      comment: parsed.comment,
    });
    if (!res.ok) {
      const messages: Record<typeof res.code, string> = {
        not_found: "Ученик не найден",
        not_activated: "Ученик ещё не активировал аккаунт — продлевать нечего",
        date_not_future: "Дата должна быть позже текущего окончания доступа",
        blocked: "Ученик заблокирован — сначала сними блокировку, потом продлевай доступ",
      };
      throw new ActionError(res.code, messages[res.code]);
    }
    revalidateStudent(parsed.userId);
    return { newAccessUntilText: formatDateRu(res.newAccessUntil, auth.user.timezone) };
  });
}

// --- Bulk student ops (spec 13.1/C5) — students.manage ---

const bulkIdsSchema = z.array(z.string().min(1)).min(1, "Выбери учеников").max(500);
const bulkExtendSchema = z.object({
  userIds: bulkIdsSchema,
  days: z.union([z.literal(30), z.literal(90)]),
});
const bulkFreezeSchema = z.object({ userIds: bulkIdsSchema });

/** Bulk «продлить доступ» (+30/+90) over a selection (spec 13.1/C5). */
export async function bulkExtendAccessAction(
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("students.manage");
    const parsed = parseInput(bulkExtendSchema, input);
    const res = await bulkExtendAccess(prisma, {
      actorId: auth.user.id,
      userIds: parsed.userIds,
      days: parsed.days,
    });
    revalidateStudent();
    // Blocked students are surfaced separately from ordinary «не активированы»
    // skips so an admin never lifts a security block without noticing (13.2 audit).
    const otherSkipped = res.skipped - res.blocked;
    const parts: string[] = [];
    if (otherSkipped > 0) parts.push(`${otherSkipped} пропущено (не активированы)`);
    if (res.blocked > 0) parts.push(`${res.blocked} заблокировано (нужен разбан)`);
    const skipNote = parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
    return { message: `Продлено на ${parsed.days} дн.: ${res.extended}${skipNote}` };
  });
}

/** Bulk «подарить заморозку» over a selection (spec 13.1/C5). */
export async function bulkGiftFreezeAction(
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("students.manage");
    const parsed = parseInput(bulkFreezeSchema, input);
    const res = await bulkGrantFreeze(prisma, { actorId: auth.user.id, userIds: parsed.userIds });
    revalidateStudent();
    const skipNote = res.skipped > 0 ? ` · ${res.skipped} пропущено (максимум)` : "";
    return { message: `Заморозка подарена: ${res.granted}${skipNote}` };
  });
}

// --- Change email (spec 13.1/D2): owner-only ---

const changeEmailSchema = z.object({ userId: z.string().min(1), email: emailSchema });

/** Change a student's login email — owner-only (spec 13.1/D2). Sessions survive. */
export async function changeStudentEmailAction(
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  return runAction(async () => {
    const auth = await requireActionOwner();
    const parsed = parseInput(changeEmailSchema, input);
    const res = await changeStudentEmail(prisma, {
      actorId: auth.user.id,
      userId: parsed.userId,
      email: parsed.email,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "exists" ? "Этот email уже занят другим аккаунтом" : "Ученик не найден",
      );
    }
    revalidateStudent(parsed.userId);
    return { email: res.email };
  });
}

/** Single «подарить заморозку» from the student card (spec 7.7). */
export async function giftFreezeAction(
  userId: string,
): Promise<ActionResult<{ granted: boolean }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("students.manage");
    const res = await grantFreeze(prisma, {
      actorId: auth.user.id,
      userId: parseInput(z.string().min(1), userId),
    });
    if (!res.ok) throw new ActionError(res.code, "Ученик не найден");
    revalidateStudent(userId);
    return { granted: res.granted };
  });
}

export async function blockStudentAction(userId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("students.manage");
    const res = await blockStudent(prisma, { actorId: auth.user.id, userId });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "wrong_status" ? "Ученик уже заблокирован" : "Ученик не найден",
      );
    }
    revalidateStudent(userId);
    return undefined;
  });
}

export async function unblockStudentAction(userId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("students.manage");
    const res = await unblockStudent(prisma, { actorId: auth.user.id, userId });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "wrong_status" ? "Ученик не заблокирован" : "Ученик не найден",
      );
    }
    revalidateStudent(userId);
    return undefined;
  });
}

export async function resetStudentSessionsAction(userId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("students.manage");
    const res = await adminResetSessions(prisma, { actorId: auth.user.id, userId });
    if (!res.ok) {
      throw new ActionError(res.code, "Ученик не найден");
    }
    revalidateStudent(userId);
    return undefined;
  });
}

/** Per-student section access toggle (spec 7.9/7.10, 12.1/C3) — admin card. */
export async function setSectionAccessAction(input: {
  userId: string;
  section: "library" | "resume" | "legend";
  enabled: boolean;
}): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("students.manage");
    const parsed = parseInput(sectionAccessSchema, input);
    const res = await setSectionAccess(prisma, {
      actorId: auth.user.id,
      userId: parsed.userId,
      section: parsed.section,
      enabled: parsed.enabled,
    });
    if (!res.ok) throw new ActionError(res.code, "Ученик не найден");
    revalidateStudent(parsed.userId);
    return undefined;
  });
}

// --- Impersonation (spec 7.2): «Глазами ученика» ---

export async function impersonateAction(userId: string): Promise<ActionResult<undefined>> {
  let started = false;

  const result = await runAction<undefined>(async () => {
    const auth = await requireActionPermission("students.manage");
    if (auth.impersonated) {
      throw new ActionError("impersonation_readonly", "Ты уже в режиме просмотра");
    }
    const ctx = await getRequestContext();
    const res = await startImpersonation(prisma, {
      actor: auth.user,
      targetUserId: userId,
      ip: ctx.ip,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "not_found"
          ? "Ученик не найден"
          : "Посмотреть можно только за активированного и не заблокированного ученика",
      );
    }
    const jar = await cookies();
    const ownToken = jar.get(SESSION_COOKIE)?.value;
    if (ownToken) {
      // The admin's own token moves to the return-point cookie for the exit path.
      jar.set(IMPERSONATION_RETURN_COOKIE, ownToken, impersonationCookieOptions());
    }
    jar.set(SESSION_COOKIE, res.token, sessionCookieOptions());
    started = true;
    return undefined;
  });

  if (result.ok && started) redirect("/");
  return result;
}

export async function stopImpersonationAction(): Promise<void> {
  const auth = await getAuth();
  const jar = await cookies();
  const returnToken = jar.get(IMPERSONATION_RETURN_COOKIE)?.value ?? null;

  let studentId: string | null = null;
  if (auth.state === "valid" && auth.session.impersonatorId) {
    studentId = auth.session.userId;
    await stopImpersonation(prisma, auth.session);
  }

  if (returnToken) {
    const original = await validateSessionToken(prisma, returnToken);
    if (original.state === "valid") {
      jar.set(SESSION_COOKIE, returnToken, sessionCookieOptions());
      jar.set(IMPERSONATION_RETURN_COOKIE, "", clearedCookieOptions());
      redirect(studentId ? `/admin/students/${studentId}` : "/admin/students");
    }
  }
  // No way back (expired/lost admin session) — clean sign-out.
  jar.set(SESSION_COOKIE, "", clearedCookieOptions());
  jar.set(IMPERSONATION_RETURN_COOKIE, "", clearedCookieOptions());
  redirect("/login");
}
