import { env } from "@/lib/env";

export const SESSION_COOKIE = "session";
export const DEVICE_COOKIE = "device_id";
/** Holds the admin's own session token while impersonating a student. */
export const IMPERSONATION_RETURN_COOKIE = "imp_return";

const base = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.isProduction,
  path: "/",
};

// DECISION: the cookie deliberately outlives the DB session (rolling 30 days,
// spec 7.2) — an RSC render cannot refresh cookies, so validity is enforced
// server-side and the cookie is just a long-lived carrier.
export function sessionCookieOptions() {
  return { ...base, maxAge: 400 * 24 * 60 * 60 };
}

export function deviceCookieOptions() {
  return { ...base, maxAge: 400 * 24 * 60 * 60 };
}

export function impersonationCookieOptions() {
  return { ...base, maxAge: 12 * 60 * 60 };
}

export function clearedCookieOptions() {
  return { ...base, maxAge: 0 };
}
