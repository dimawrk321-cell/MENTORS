import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import {
  validateSessionToken,
  type SessionValidation,
  type SessionWithUser,
} from "@/lib/services/sessions";

// DECISION: zone access is enforced by route-group layout guards plus per-action
// checks — not by middleware.ts: Prisma is unavailable on the edge runtime and
// the spec's «middleware» reads as the logical enforcement layer, which these
// guards are. Every path into a zone goes through exactly one of the helpers below.

const ROLE_RANK: Record<Role, number> = { student: 0, mentor: 1, admin: 2, owner: 3 };

export function hasRole(user: Pick<User, "role">, min: Role): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[min];
}

/** Per-request memoized session resolution (React cache → one DB hit per render). */
export const getAuth = cache(async (): Promise<SessionValidation> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return { state: "none" };
  return validateSessionToken(prisma, token);
});

export interface ZoneAuth {
  user: User;
  session: SessionWithUser;
  impersonated: boolean;
}

/** Where a signed-in user belongs (spec 8.1: student → «/», mentor+ → /admin). */
export function homePathFor(user: User, accessExpired: boolean): string {
  if (user.role !== "student") return "/admin";
  return accessExpired ? "/expired" : "/";
}

function redirectToLogin(auth: SessionValidation): never {
  redirect(auth.state === "evicted" ? "/login?reason=evicted" : "/login");
}

/** Active student pages: sidebar zone. Expired accounts are soft-locked to /expired. */
export async function requireStudentZone(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.role !== "student") redirect("/admin");
  if (auth.accessExpired) redirect("/expired");
  return {
    user: auth.user,
    session: auth.session,
    impersonated: auth.session.impersonatorId !== null,
  };
}

/** The /expired screen — the only page available under soft-lock (spec 7.1.5). */
export async function requireExpiredStudent(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.role !== "student") redirect("/admin");
  if (!auth.accessExpired) redirect("/");
  return {
    user: auth.user,
    session: auth.session,
    impersonated: auth.session.impersonatorId !== null,
  };
}

/** Admin zone: mentor and above (sections are additionally filtered by role). */
export async function requireAdminZone(min: Role = "mentor"): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (!hasRole(auth.user, min)) {
    redirect(homePathFor(auth.user, auth.accessExpired));
  }
  return {
    user: auth.user,
    session: auth.session,
    impersonated: auth.session.impersonatorId !== null,
  };
}

export async function requireInterviewerZone(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (!auth.user.isInterviewer) {
    redirect(homePathFor(auth.user, auth.accessExpired));
  }
  return {
    user: auth.user,
    session: auth.session,
    impersonated: auth.session.impersonatorId !== null,
  };
}

/** For public auth pages: bounce already-signed-in visitors to their zone. */
export async function redirectIfAuthenticated(): Promise<void> {
  const auth = await getAuth();
  if (auth.state === "valid") {
    redirect(homePathFor(auth.user, auth.accessExpired));
  }
}
