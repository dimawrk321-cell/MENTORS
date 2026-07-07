import type { Prisma, SessionRevokeReason, User } from "@prisma/client";
import type { Db } from "@/lib/db";
import { generateToken, sha256Hex } from "@/lib/utils/crypto";
import { parseUserAgent } from "@/lib/utils/user-agent";
import { emitEvent } from "@/lib/services/events";
import { writeAudit } from "@/lib/services/audit";

// Session & device rules (spec 7.2): random 256-bit token (DB stores sha256),
// rolling 30 days, one concurrent session, two remembered devices.

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Rolling renewal is throttled so reads do not write on every request.
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const DEVICE_LIMIT = 2;
// DECISION: impersonation sessions are short-lived (4h, no rolling) — a viewing
// mode, not a login; the spec does not pin their TTL.
export const IMPERSONATION_TTL_MS = 4 * 60 * 60 * 1000;

const EVICTION_REASONS: SessionRevokeReason[] = ["evicted_login", "evicted_device"];

export type SessionWithUser = Prisma.SessionGetPayload<{ include: { user: true } }>;

export type SessionValidation =
  | { state: "none" }
  | { state: "evicted" }
  | { state: "valid"; session: SessionWithUser; user: User; accessExpired: boolean };

interface CreateSessionInput {
  userId: string;
  deviceId: string | null;
  ip: string;
  city?: string | null;
  country?: string | null;
  impersonatorId?: string | null;
  ttlMs?: number;
  now?: Date;
}

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ token: string; sessionId: string }> {
  const now = input.now ?? new Date();
  const token = generateToken();
  const session = await db.session.create({
    data: {
      userId: input.userId,
      tokenHash: sha256Hex(token),
      deviceId: input.deviceId,
      ip: input.ip,
      city: input.city ?? null,
      country: input.country ?? null,
      impersonatorId: input.impersonatorId ?? null,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? SESSION_TTL_MS)),
      lastActiveAt: now,
      createdAt: now,
    },
  });
  return { token, sessionId: session.id };
}

interface RevokeSessionsInput {
  userId: string;
  reason: SessionRevokeReason;
  exceptSessionId?: string;
  onlyDeviceId?: string;
  /** Impersonation sessions are observers — most flows leave them alone. */
  includeImpersonated?: boolean;
  now?: Date;
}

/**
 * Revokes matching active sessions (keeping the rows as tombstones for the
 * eviction screen) and emits `session.evicted` for forced terminations.
 */
export async function revokeSessions(db: Db, input: RevokeSessionsInput): Promise<number> {
  const now = input.now ?? new Date();
  const where: Prisma.SessionWhereInput = {
    userId: input.userId,
    revokedAt: null,
    ...(input.exceptSessionId ? { id: { not: input.exceptSessionId } } : {}),
    ...(input.onlyDeviceId ? { deviceId: input.onlyDeviceId } : {}),
    ...(input.includeImpersonated ? {} : { impersonatorId: null }),
  };
  const sessions = await db.session.findMany({ where, select: { id: true } });
  if (sessions.length === 0) return 0;

  await db.session.updateMany({
    where: { id: { in: sessions.map((s) => s.id) } },
    data: { revokedAt: now, revokedReason: input.reason },
  });

  const forced = ["evicted_login", "evicted_device", "admin_reset", "blocked"].includes(
    input.reason,
  );
  if (forced) {
    for (const session of sessions) {
      await emitEvent(
        db,
        "session.evicted",
        { sessionId: session.id, reason: input.reason },
        { userId: input.userId },
      );
    }
  }
  return sessions.length;
}

export async function revokeSessionById(
  db: Db,
  sessionId: string,
  reason: SessionRevokeReason,
  now: Date = new Date(),
): Promise<void> {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
}

export interface RegisteredDevice {
  deviceId: string;
  deviceCookieId: string;
  label: string;
  isNew: boolean;
  hadOtherDevices: boolean;
  evictedDeviceLabel: string | null;
}

interface RegisterDeviceInput {
  userId: string;
  /** Long-lived random cookie mark; generated here when the browser has none. */
  deviceCookieId: string | null;
  userAgent: string | null;
  now?: Date;
}

/**
 * Resolves the browser to a device row. Fingerprint = sha256(cookie mark +
 * stable UA platform traits) — spec 7.2. Logging in from a third device evicts
 * the stalest one by last_seen_at.
 */
export async function registerDevice(
  db: Db,
  input: RegisterDeviceInput,
): Promise<RegisteredDevice> {
  const now = input.now ?? new Date();
  const deviceCookieId = input.deviceCookieId ?? generateToken();
  const ua = parseUserAgent(input.userAgent);
  const fingerprintHash = sha256Hex(`${deviceCookieId}|${ua.platformKey}`);

  const existing = await db.device.findUnique({
    where: { userId_fingerprintHash: { userId: input.userId, fingerprintHash } },
  });
  if (existing) {
    await db.device.update({
      where: { id: existing.id },
      data: { lastSeenAt: now, label: ua.label },
    });
    return {
      deviceId: existing.id,
      deviceCookieId,
      label: ua.label,
      isNew: false,
      hadOtherDevices: false,
      evictedDeviceLabel: null,
    };
  }

  const others = await db.device.findMany({
    where: { userId: input.userId },
    orderBy: { lastSeenAt: "asc" },
  });

  let evictedDeviceLabel: string | null = null;
  const oldest = others[0];
  if (others.length >= DEVICE_LIMIT && oldest) {
    // Spec 7.2: третий девайс вытесняет самый старый по last_seen_at.
    await revokeSessions(db, {
      userId: input.userId,
      reason: "evicted_device",
      onlyDeviceId: oldest.id,
      now,
    });
    await db.device.delete({ where: { id: oldest.id } });
    evictedDeviceLabel = oldest.label;
  }

  const created = await db.device.create({
    data: {
      userId: input.userId,
      fingerprintHash,
      label: ua.label,
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });

  return {
    deviceId: created.id,
    deviceCookieId,
    label: ua.label,
    isNew: true,
    hadOtherDevices: others.length > 0,
    evictedDeviceLabel,
  };
}

/** Effective soft-lock check (spec 7.1.5): the status flip may lag behind the clock. */
export function isAccessExpired(user: User, now: Date = new Date()): boolean {
  if (user.role !== "student") return false;
  if (user.status === "expired") return true;
  return user.status === "active" && user.accessUntil !== null && user.accessUntil <= now;
}

/**
 * Resolves a cookie token to a live session. Distinguishes «evicted» (another
 * login displaced this one — spec 7.2 screen) from a plain missing/expired
 * session. Applies the throttled rolling renewal on the happy path.
 */
export async function validateSessionToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<SessionValidation> {
  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: true },
  });
  if (!session) return { state: "none" };

  if (session.revokedAt) {
    return session.revokedReason && EVICTION_REASONS.includes(session.revokedReason)
      ? { state: "evicted" }
      : { state: "none" };
  }
  if (session.expiresAt <= now) return { state: "none" };
  // Blocked users are logged out at block time; this is the safety net.
  if (session.user.status === "blocked" || session.user.status === "invited") {
    return { state: "none" };
  }

  // Lazy expiry (spec 7.1.5): the daily worker arrives at stage 9 — ANY request
  // of an overdue active student flips the status right here, so layout guards
  // and action checks see the account as expired immediately, not only after a
  // re-login.
  if (
    session.user.role === "student" &&
    session.user.status === "active" &&
    session.user.accessUntil !== null &&
    session.user.accessUntil <= now
  ) {
    await db.user.update({ where: { id: session.userId }, data: { status: "expired" } });
    await emitEvent(db, "access.expired", { via: "request" }, { userId: session.userId });
    session.user.status = "expired";
  }

  // Rolling 30 days — throttled; impersonation sessions never roll and never
  // touch the student's activity timestamps.
  if (
    !session.impersonatorId &&
    now.getTime() - session.lastActiveAt.getTime() > SESSION_TOUCH_INTERVAL_MS
  ) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await Promise.all([
      db.session.update({
        where: { id: session.id },
        data: { lastActiveAt: now, expiresAt },
      }),
      db.user.update({ where: { id: session.userId }, data: { lastSeenAt: now } }),
      session.deviceId
        ? db.device.update({ where: { id: session.deviceId }, data: { lastSeenAt: now } })
        : Promise.resolve(),
    ]);
    session.lastActiveAt = now;
    session.expiresAt = expiresAt;
  }

  return {
    state: "valid",
    session,
    user: session.user,
    accessExpired: isAccessExpired(session.user, now),
  };
}

// --- Impersonation (spec 7.2): admin+ opens a read-only session as a student ---

export async function startImpersonation(
  db: Db,
  input: { actor: User; targetUserId: string; ip: string; now?: Date },
): Promise<{ ok: true; token: string } | { ok: false; code: "not_found" | "not_impersonatable" }> {
  const now = input.now ?? new Date();
  const target = await db.user.findUnique({ where: { id: input.targetUserId } });
  if (!target || target.role !== "student") return { ok: false, code: "not_found" };
  // Blocked and not-yet-activated accounts have no student experience to view.
  if (target.status === "blocked" || target.status === "invited") {
    return { ok: false, code: "not_impersonatable" };
  }

  const { token } = await createSession(db, {
    userId: target.id,
    deviceId: null,
    ip: input.ip,
    impersonatorId: input.actor.id,
    ttlMs: IMPERSONATION_TTL_MS,
    now,
  });
  await writeAudit(db, {
    actorId: input.actor.id,
    action: "impersonation.started",
    entityType: "user",
    entityId: target.id,
  });
  return { ok: true, token };
}

export async function stopImpersonation(
  db: Db,
  session: SessionWithUser,
  now: Date = new Date(),
): Promise<void> {
  await revokeSessionById(db, session.id, "impersonation_end", now);
  if (session.impersonatorId) {
    await writeAudit(db, {
      actorId: session.impersonatorId,
      action: "impersonation.stopped",
      entityType: "user",
      entityId: session.userId,
    });
  }
}

/** Active (non-impersonated) sessions for profile/admin lists. */
export async function listActiveSessions(db: Db, userId: string, now: Date = new Date()) {
  return db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now }, impersonatorId: null },
    orderBy: { lastActiveAt: "desc" },
    select: {
      id: true,
      ip: true,
      city: true,
      country: true,
      deviceId: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
}
