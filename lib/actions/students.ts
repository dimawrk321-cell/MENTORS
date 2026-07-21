"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  adminResetSessions,
  blockStudent,
  extendAccess,
  inviteMentor,
  inviteStudent,
  resendInvite,
  unblockStudent,
} from "@/lib/services/access";
import {
  startImpersonation,
  stopImpersonation,
  validateSessionToken,
} from "@/lib/services/sessions";
import { setSectionAccess } from "@/lib/services/library";
import { adminIssuePasswordReset } from "@/lib/services/auth";
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
  requireActionRole,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  extendAccessSchema,
  inviteMentorSchema,
  inviteStudentSchema,
  sectionAccessSchema,
} from "@/lib/utils/validation";
import { formatDateRu } from "@/lib/utils/dates";

// Admin student management (spec 2: доступ выдаёт admin+). Every mutation is
// audited inside the services.

function revalidateStudent(userId?: string): void {
  revalidatePath("/admin/students");
  if (userId) revalidatePath(`/admin/students/${userId}`);
}

export interface InviteCreated {
  userId: string;
  inviteUrl: string;
  email: string;
  name: string;
}

export type InviteFormState = ActionResult<InviteCreated> | null;

export async function inviteStudentAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  return runAction<InviteCreated>(async () => {
    const auth = await requireActionRole("admin");
    const input = parseInput(inviteStudentSchema, {
      email: formData.get("email"),
      name: formData.get("name"),
    });
    const res = await inviteStudent(prisma, {
      actorId: auth.user.id,
      email: input.email,
      name: input.name,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "already_invited"
          ? "Этот email уже приглашён — открой карточку и отправь инвайт повторно"
          : "Пользователь с таким email уже существует",
      );
    }
    revalidateStudent(res.userId);
    return { userId: res.userId, inviteUrl: res.inviteUrl, email: input.email, name: input.name };
  });
}

/**
 * Invite a mentor (spec 2: назначать роли — owner-only). Same invite flow, role
 * mentor + is_interviewer checkbox — closes the manual-SQL path. Audited.
 */
export async function inviteMentorAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  return runAction<InviteCreated>(async () => {
    const auth = await requireActionRole("owner");
    const input = parseInput(inviteMentorSchema, {
      email: formData.get("email"),
      name: formData.get("name"),
      isInterviewer: formData.get("isInterviewer") === "on",
    });
    const res = await inviteMentor(prisma, {
      actorId: auth.user.id,
      email: input.email,
      name: input.name,
      isInterviewer: input.isInterviewer,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "already_invited"
          ? "Этот email уже приглашён"
          : "Пользователь с таким email уже существует",
      );
    }
    revalidateStudent(res.userId);
    return { userId: res.userId, inviteUrl: res.inviteUrl, email: input.email, name: input.name };
  });
}

export async function resendInviteAction(
  userId: string,
): Promise<ActionResult<{ inviteUrl: string }>> {
  return runAction(async () => {
    const auth = await requireActionRole("admin");
    const res = await resendInvite(prisma, { actorId: auth.user.id, userId });
    if (!res.ok) {
      throw new ActionError(res.code, "Инвайт уже принят или ученик не найден");
    }
    revalidateStudent(userId);
    return { inviteUrl: res.inviteUrl };
  });
}

export async function issuePasswordResetLinkAction(
  userId: string,
): Promise<ActionResult<{ resetUrl: string }>> {
  return runAction(async () => {
    const auth = await requireActionRole("admin");
    // No more than one link per student per minute (spec P1).
    if (isApiRateLimited(`reset-issue:${userId}`, 1, 60_000)) {
      throw new ActionError("rate_limited", "Ссылку можно выдавать не чаще раза в минуту");
    }
    const res = await adminIssuePasswordReset(prisma, { actorId: auth.user.id, userId });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "not_eligible"
          ? "Сброс доступен только активированным ученикам"
          : "Ученик не найден",
      );
    }
    revalidateStudent(userId);
    return { resetUrl: res.resetUrl };
  });
}

export async function extendAccessAction(
  input: unknown,
): Promise<ActionResult<{ newAccessUntilText: string }>> {
  return runAction(async () => {
    const auth = await requireActionRole("admin");
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
      };
      throw new ActionError(res.code, messages[res.code]);
    }
    revalidateStudent(parsed.userId);
    return { newAccessUntilText: formatDateRu(res.newAccessUntil, auth.user.timezone) };
  });
}

export async function blockStudentAction(userId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("admin");
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
    const auth = await requireActionRole("admin");
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
    const auth = await requireActionRole("admin");
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
    const auth = await requireActionRole("admin");
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
    const auth = await requireActionRole("admin");
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
