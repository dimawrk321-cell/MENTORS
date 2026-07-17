import type { PrismaClient } from "@prisma/client";
import { DAY_MS } from "@/lib/utils/dates";

// sessionCleanup job (spec 7.15): 05:00 daily. Purges expired/consumed auth
// artifacts — expired sessions, old revoked sessions (kept a week so the
// «вход на другом устройстве» screen can still render — spec 7.2), expired/used
// password resets, expired/accepted invites. Idempotent (delete-by-predicate).

const REVOKED_RETENTION_DAYS = 7;

export async function runSessionCleanupJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ sessions: number; resets: number; invites: number }> {
  const revokedCutoff = new Date(now.getTime() - REVOKED_RETENTION_DAYS * DAY_MS);

  const sessions = await db.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: revokedCutoff } }],
    },
  });
  const resets = await db.passwordReset.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] },
  });
  const invites = await db.invite.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { acceptedAt: { not: null } }] },
  });

  return { sessions: sessions.count, resets: resets.count, invites: invites.count };
}
