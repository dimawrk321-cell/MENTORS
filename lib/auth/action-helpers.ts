import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { Role } from "@prisma/client";
import type { ZodType } from "zod";
import { logger } from "@/lib/logger";
import { getAuth, hasRole, type ZoneAuth } from "@/lib/auth/guards";

// Shared plumbing for Server Actions: uniform result shape (spec 9), RBAC on
// every mutation (spec 3), impersonation read-only enforcement (spec 7.2).

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Business error with a ready-to-show Russian message. */
export class ActionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    // redirect()/notFound() must propagate to the framework.
    unstable_rethrow(error);
    if (error instanceof ActionError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    logger.error({ err: error }, "unexpected server action error");
    return {
      ok: false,
      error: { code: "internal", message: "Что-то пошло не так. Попробуй ещё раз" },
    };
  }
}

/** Zod parse that converts the first issue into a user-facing ActionError. */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Проверь введённые данные";
    throw new ActionError("validation", message);
  }
  return result.data;
}

export async function requireActionAuth(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") {
    throw new ActionError("unauthorized", "Сессия истекла — войди заново");
  }
  return {
    user: auth.user,
    session: auth.session,
    impersonated: auth.session.impersonatorId !== null,
    accessExpired: auth.accessExpired,
  };
}

export async function requireActionRole(min: Role): Promise<ZoneAuth> {
  const auth = await requireActionAuth();
  if (!hasRole(auth.user, min)) {
    throw new ActionError("forbidden", "Недостаточно прав");
  }
  return auth;
}

/** Student-only actions (learning flow — spec 2: только student проходит обучение). */
export async function requireActionStudent(): Promise<ZoneAuth> {
  const auth = await requireActionAuth();
  if (auth.user.role !== "student") {
    throw new ActionError("forbidden", "Действие доступно только ученикам");
  }
  return auth;
}

/** Interviewer-cabinet actions (spec 2/8.4): guarded by the is_interviewer flag. */
export async function requireActionInterviewer(): Promise<ZoneAuth> {
  const auth = await requireActionAuth();
  if (!auth.user.isInterviewer) {
    throw new ActionError("forbidden", "Действие доступно только интервьюерам");
  }
  return auth;
}

/** Impersonation is strictly read-only (spec 7.2): every mutation calls this. */
export function assertNotImpersonating(auth: ZoneAuth): void {
  if (auth.impersonated) {
    throw new ActionError("impersonation_readonly", "Режим просмотра — изменения недоступны");
  }
}

/** Soft-lock (spec 7.1.5): student actions are unavailable once access is over. */
export function assertActiveAccess(auth: ZoneAuth): void {
  if (auth.user.role === "student" && auth.accessExpired) {
    throw new ActionError("access_expired", "Доступ завершён — продли его, чтобы продолжить");
  }
}

/** Client network context for services (IP for rate limits/GeoIP, UA for devices). */
export async function getRequestContext(): Promise<{ ip: string; userAgent: string | null }> {
  const headerBag = await headers();
  const forwarded = headerBag.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headerBag.get("x-real-ip") || "127.0.0.1";
  return { ip, userAgent: headerBag.get("user-agent") };
}
