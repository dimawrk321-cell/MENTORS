import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { SET_PASSWORD_PATH, type Permission } from "@/lib/constants";
import { firstAllowedAdminPath, hasPermission, isStaff } from "@/lib/auth/permissions";
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
  /** Soft-lock state (spec 7.1.5): true for a student whose access window is over. */
  accessExpired: boolean;
}

/** Where a signed-in user belongs (spec 8.1: student → «/», mentor+ → /admin). */
export function homePathFor(user: User, accessExpired: boolean): string {
  // Walk 12.4/A2: an admin-issued credential forces the set-password screen first.
  if (user.mustChangePassword) return SET_PASSWORD_PATH;
  if (user.role !== "student") return "/admin";
  return accessExpired ? "/expired" : "/";
}

function redirectToLogin(auth: SessionValidation): never {
  redirect(auth.state === "evicted" ? "/login?reason=evicted" : "/login");
}

function toZoneAuth(auth: Extract<SessionValidation, { state: "valid" }>): ZoneAuth {
  return {
    user: auth.user,
    session: auth.session,
    impersonated: auth.session.impersonatorId !== null,
    accessExpired: auth.accessExpired,
  };
}

/**
 * Active student pages: sidebar zone. Expired accounts are soft-locked to
 * /expired. Walk 12.4: a pending password change is forced before anything; a
 * student without a name yet is sent to onboarding (the mandatory name screen —
 * `onboarding: true` exempts the onboarding page itself to avoid a redirect loop).
 */
export async function requireStudentZone(opts?: { onboarding?: boolean }): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.role !== "student") redirect("/admin");
  if (auth.user.mustChangePassword) redirect(SET_PASSWORD_PATH);
  if (auth.accessExpired) redirect("/expired");
  if (!opts?.onboarding && auth.user.name.trim() === "") redirect("/onboarding");
  return toZoneAuth(auth);
}

/** The /expired screen — the only page available under soft-lock (spec 7.1.5). */
export async function requireExpiredStudent(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.role !== "student") redirect("/admin");
  if (auth.user.mustChangePassword) redirect(SET_PASSWORD_PATH);
  if (!auth.accessExpired) redirect("/");
  return toZoneAuth(auth);
}

/** Admin zone chrome: staff (mentor+) — pages/actions refine by permission (12.4/B2). */
export async function requireAdminZone(min: Role = "mentor"): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.mustChangePassword) redirect(SET_PASSWORD_PATH);
  if (!hasRole(auth.user, min)) {
    redirect(homePathFor(auth.user, auth.accessExpired));
  }
  return toZoneAuth(auth);
}

/**
 * Admin page guard by permission (spec 12.4/B2). owner passes unconditionally;
 * a staff member lacking the permission lands on their first accessible section
 * (never a loop); a student is sent home.
 */
export async function requirePermission(perm: Permission): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.mustChangePassword) redirect(SET_PASSWORD_PATH);
  if (!isStaff(auth.user)) redirect(homePathFor(auth.user, auth.accessExpired));
  if (!hasPermission(auth.user, perm)) redirect(firstAllowedAdminPath(auth.user));
  return toZoneAuth(auth);
}

/** Owner-only admin pages (spec 12.4/B3): Команда, Аудит. */
export async function requireOwnerZone(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.mustChangePassword) redirect(SET_PASSWORD_PATH);
  if (auth.user.role !== "owner") {
    if (!isStaff(auth.user)) redirect(homePathFor(auth.user, auth.accessExpired));
    redirect(firstAllowedAdminPath(auth.user));
  }
  return toZoneAuth(auth);
}

/** Forced initial-password screen (spec 12.4/A2): only reachable with the flag set. */
export async function requirePasswordSetup(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (!auth.user.mustChangePassword) redirect(homePathFor(auth.user, auth.accessExpired));
  return toZoneAuth(auth);
}

export async function requireInterviewerZone(): Promise<ZoneAuth> {
  const auth = await getAuth();
  if (auth.state !== "valid") redirectToLogin(auth);
  if (auth.user.mustChangePassword) redirect(SET_PASSWORD_PATH);
  if (!auth.user.isInterviewer) {
    redirect(homePathFor(auth.user, auth.accessExpired));
  }
  return toZoneAuth(auth);
}

/** For public auth pages: bounce already-signed-in visitors to their zone. */
export async function redirectIfAuthenticated(): Promise<void> {
  const auth = await getAuth();
  if (auth.state === "valid") {
    redirect(homePathFor(auth.user, auth.accessExpired));
  }
}
