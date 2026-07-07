import type { AuthAttemptKind } from "@prisma/client";
import type { Db } from "@/lib/db";

// Spec 7.2: /login and /forgot — 5 attempts / 15 min per email+IP.
// Spec 11: in-memory limiter + a DB table for login failures (restart-safe).
export const AUTH_ATTEMPT_LIMIT = 5;
export const AUTH_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

// In-memory fast path: buckets already known to be over the limit skip the
// COUNT query until their window slides past. Single web process — no
// cross-instance coordination needed (spec deploy: one `web` container).
const blockedUntil = new Map<string, number>();

function bucketKey(kind: AuthAttemptKind, email: string, ip: string): string {
  return `${kind}:${email}:${ip}`;
}

export async function isAuthRateLimited(
  db: Db,
  kind: AuthAttemptKind,
  email: string,
  ip: string,
  now: Date = new Date(),
): Promise<boolean> {
  const key = bucketKey(kind, email, ip);
  const memoryBlock = blockedUntil.get(key);
  if (memoryBlock !== undefined) {
    if (memoryBlock > now.getTime()) return true;
    blockedUntil.delete(key);
  }

  const windowStart = new Date(now.getTime() - AUTH_ATTEMPT_WINDOW_MS);
  const count = await db.authAttempt.count({
    where: { kind, email, ip, createdAt: { gt: windowStart } },
  });
  if (count >= AUTH_ATTEMPT_LIMIT) {
    // Conservative: block for a full window from now; the DB stays the source
    // of truth after restarts, memory only saves repeat queries.
    blockedUntil.set(key, now.getTime() + AUTH_ATTEMPT_WINDOW_MS);
    return true;
  }
  return false;
}

export async function recordAuthAttempt(
  db: Db,
  kind: AuthAttemptKind,
  email: string,
  ip: string,
  now: Date = new Date(),
): Promise<void> {
  await db.authAttempt.create({ data: { kind, email, ip, createdAt: now } });
  // Opportunistic prune keeps the table small without a dedicated job
  // (sessionCleanup takes over at stage 9).
  await db.authAttempt.deleteMany({
    where: {
      kind,
      email,
      ip,
      createdAt: { lte: new Date(now.getTime() - AUTH_ATTEMPT_WINDOW_MS) },
    },
  });
}

/** A successful login clears the failure budget for its bucket. */
export async function clearAuthAttempts(
  db: Db,
  kind: AuthAttemptKind,
  email: string,
  ip: string,
): Promise<void> {
  blockedUntil.delete(bucketKey(kind, email, ip));
  await db.authAttempt.deleteMany({ where: { kind, email, ip } });
}

// Generic in-memory limiter for route handlers (spec 7.2: API — 120 rpm per
// user); stage 1 has no API routes yet, wired as they appear.
const apiBuckets = new Map<string, { windowStart: number; count: number }>();

export function isApiRateLimited(
  key: string,
  limit = 120,
  windowMs = 60_000,
  nowMs = Date.now(),
): boolean {
  const bucket = apiBuckets.get(key);
  if (!bucket || nowMs - bucket.windowStart >= windowMs) {
    apiBuckets.set(key, { windowStart: nowMs, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}
