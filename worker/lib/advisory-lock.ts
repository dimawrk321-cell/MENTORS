import type { PrismaClient } from "@prisma/client";

// Postgres advisory locks (spec 7.15 task: «защищена от параллельного запуска»).
// A job is claimed with pg_try_advisory_lock keyed by a stable hash of its name;
// a second worker (or a re-entrant run) that can't get the lock skips this tick.
//
// IMPORTANT: session-level advisory locks live on the CONNECTION that took them
// and must be released on the SAME connection. Prisma pools connections, so lock
// and unlock could otherwise land on different ones. Callers therefore pass a
// dedicated single-connection client (`connection_limit=1`) — the worker creates
// one, tests create their own — so lock/unlock always share a session.

/** Stable signed-32-bit key from a job name (djb2-xor). */
export function jobLockKey(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) {
    h = (Math.imul(33, h) ^ name.charCodeAt(i)) | 0;
  }
  return h;
}

export async function tryAdvisoryLock(lockDb: PrismaClient, key: number): Promise<boolean> {
  const rows = await lockDb.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${BigInt(key)}) AS locked`;
  return rows[0]?.locked === true;
}

export async function advisoryUnlock(lockDb: PrismaClient, key: number): Promise<void> {
  await lockDb.$queryRaw`SELECT pg_advisory_unlock(${BigInt(key)})`;
}

export interface LockOutcome<T> {
  /** false ⇒ another run holds the lock; fn was not called. */
  ran: boolean;
  result?: T;
}

/**
 * Runs `fn` under the named advisory lock. Returns `{ ran: false }` without
 * calling `fn` when the lock is already held. Always releases on the way out.
 */
export async function withAdvisoryLock<T>(
  lockDb: PrismaClient,
  name: string,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  const key = jobLockKey(name);
  if (!(await tryAdvisoryLock(lockDb, key))) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await advisoryUnlock(lockDb, key);
  }
}
