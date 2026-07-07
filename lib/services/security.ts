import type { Prisma, User } from "@prisma/client";
import type { Db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { distanceKm, lookupIp, type GeoPoint } from "@/lib/services/geoip";
import { emitEvent } from "@/lib/services/events";
import { writeAudit } from "@/lib/services/audit";
import { revokeSessions } from "@/lib/services/sessions";
import { sendAdminSecurityAlertEmail, sendSuspiciousBlockEmail } from "@/lib/services/mail";

// Anti-sharing flags (spec 7.2). Geo flag: logins from cities > 300 km apart
// within 24h; a repeat flag within 7 days auto-blocks the account.

export const GEO_FLAG_DISTANCE_KM = 300;
export const GEO_FLAG_WINDOW_MS = 24 * 60 * 60 * 1000;
export const GEO_REPEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const RAPID_LESSONS_PER_HOUR = 30;
export const RAPID_QUESTIONS_PER_HOUR = 400;

async function autoBlockUser(db: Db, user: User, now: Date): Promise<void> {
  await db.user.update({ where: { id: user.id }, data: { status: "blocked" } });
  await revokeSessions(db, { userId: user.id, reason: "blocked", includeImpersonated: true, now });
  // System transition: actor is the affected user, action carries the system prefix.
  await writeAudit(db, {
    actorId: user.id,
    action: "system.user.auto_blocked",
    entityType: "user",
    entityId: user.id,
    before: { status: user.status },
    after: { status: "blocked", reason: "repeated concurrent_geo flag within 7 days" },
  });
  await sendSuspiciousBlockEmail(user.email);
  const admins = await db.user.findMany({
    where: { role: { in: ["admin", "owner"] } },
    select: { email: true },
  });
  for (const admin of admins) {
    await sendAdminSecurityAlertEmail(admin.email, user.email);
  }
  logger.warn({ userId: user.id }, "user auto-blocked after repeated concurrent_geo flag");
}

/**
 * Creates a concurrent_geo flag; the second flag within 7 days auto-blocks the
 * user (spec 7.2). Returns whether the user ended up blocked.
 */
async function raiseConcurrentGeoFlag(
  db: Db,
  user: User,
  details: Prisma.InputJsonObject,
  now: Date,
): Promise<{ blocked: boolean }> {
  const priorFlags = await db.securityFlag.count({
    where: {
      userId: user.id,
      type: "concurrent_geo",
      createdAt: { gt: new Date(now.getTime() - GEO_REPEAT_WINDOW_MS) },
    },
  });
  await db.securityFlag.create({
    data: { userId: user.id, type: "concurrent_geo", details, createdAt: now },
  });
  await emitEvent(db, "security.flag", { type: "concurrent_geo", ...details }, { userId: user.id });

  if (priorFlags >= 1) {
    await autoBlockUser(db, user, now);
    return { blocked: true };
  }
  return { blocked: false };
}

/**
 * Post-login geo check. Compares the fresh login's coordinates against other
 * login IPs of the last 24h. Silently does nothing when the GeoIP adapter is
 * not configured (spec changelog to 7.2).
 */
export async function checkGeoAnomalyOnLogin(
  db: Db,
  input: { user: User; ip: string; geo: GeoPoint | null; now?: Date },
): Promise<{ blocked: boolean }> {
  const now = input.now ?? new Date();
  if (!input.geo) return { blocked: false };

  const recent = await db.session.findMany({
    where: {
      userId: input.user.id,
      impersonatorId: null,
      ip: { not: input.ip },
      createdAt: { gt: new Date(now.getTime() - GEO_FLAG_WINDOW_MS) },
    },
    select: { ip: true, city: true },
    distinct: ["ip"],
  });

  for (const prior of recent) {
    const priorGeo = await lookupIp(prior.ip);
    if (!priorGeo) continue;
    const km = Math.round(distanceKm(input.geo, priorGeo));
    if (km > GEO_FLAG_DISTANCE_KM) {
      return raiseConcurrentGeoFlag(
        db,
        input.user,
        {
          current: { ip: input.ip, city: input.geo.city },
          previous: { ip: prior.ip, city: priorGeo.city ?? prior.city },
          distanceKm: km,
          windowHours: 24,
        },
        now,
      );
    }
  }
  return { blocked: false };
}

/**
 * Rapid-content flag (spec 7.2): > 30 lesson completions or > 400 question
 * opens per hour → flag, no block.
 * DECISION: the emitting events (lesson.completed, question.opened) appear at
 * stages 2–3 — this check is wired into those actions then; the service ships
 * now per the stage-1 plan line «гео/rapid-флаги».
 */
export async function checkRapidContentFlag(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ flagged: boolean }> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const [lessons, questions] = await Promise.all([
    db.analyticsEvent.count({
      where: { userId, type: "lesson.completed", createdAt: { gt: hourAgo } },
    }),
    db.analyticsEvent.count({
      where: { userId, type: "question.opened", createdAt: { gt: hourAgo } },
    }),
  ]);
  if (lessons <= RAPID_LESSONS_PER_HOUR && questions <= RAPID_QUESTIONS_PER_HOUR) {
    return { flagged: false };
  }
  // One open rapid flag per day is enough signal for the admin dashboard.
  const existing = await db.securityFlag.count({
    where: {
      userId,
      type: "rapid_content",
      status: "open",
      createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
  });
  if (existing > 0) return { flagged: true };

  const details = { lessonsLastHour: lessons, questionsLastHour: questions };
  await db.securityFlag.create({
    data: { userId, type: "rapid_content", details, createdAt: now },
  });
  await emitEvent(db, "security.flag", { type: "rapid_content", ...details }, { userId });
  return { flagged: true };
}

/** Admin resolves a flag (dashboard widget lands at stage 10). */
export async function resolveSecurityFlag(
  db: Db,
  input: { flagId: string; actorId: string },
): Promise<void> {
  await db.securityFlag.update({
    where: { id: input.flagId },
    data: { status: "resolved", resolvedById: input.actorId },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "security_flag.resolved",
    entityType: "security_flag",
    entityId: input.flagId,
  });
}
