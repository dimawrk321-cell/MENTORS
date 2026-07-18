import type { Invite, PrismaClient, User } from "@prisma/client";
import type { Db } from "@/lib/db";
import { addDays } from "@/lib/utils/dates";
import { sha256Hex, generateToken } from "@/lib/utils/crypto";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/utils/password";
import { clearAuthAttempts, isAuthRateLimited, recordAuthAttempt } from "@/lib/utils/rate-limit";
import { emitEvent } from "@/lib/services/events";
import { pauseStreak } from "@/lib/services/streak";
import { lookupIp } from "@/lib/services/geoip";
import { checkGeoAnomalyOnLogin } from "@/lib/services/security";
import { sendNewDeviceEmail, sendPasswordResetEmail } from "@/lib/services/mail";
import {
  createSession,
  registerDevice,
  revokeSessionById,
  revokeSessions,
  type SessionWithUser,
} from "@/lib/services/sessions";
import { ACCESS_INITIAL_DAYS } from "@/lib/services/access";
import { env } from "@/lib/env";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour (spec 6)

export interface RequestContext {
  ip: string;
  userAgent: string | null;
  deviceCookieId: string | null;
  now?: Date;
}

export interface AuthedSession {
  token: string;
  deviceCookieId: string;
  user: User;
}

export type LoginResult =
  | ({ ok: true } & AuthedSession)
  | { ok: false; code: "invalid_credentials" | "blocked" | "rate_limited" };

/**
 * Password login (spec 7.2): rate limit 5/15min per email+IP, argon2id verify
 * with constant-work fallback, device registration with the 2-device cap,
 * single-session eviction, geo anomaly check.
 */
export async function login(
  db: PrismaClient,
  input: { email: string; password: string },
  ctx: RequestContext,
): Promise<LoginResult> {
  const now = ctx.now ?? new Date();
  const email = input.email;

  if (await isAuthRateLimited(db, "login", email, ctx.ip, now)) {
    return { ok: false, code: "rate_limited" };
  }

  const user = await db.user.findUnique({ where: { email } });
  const verified = await verifyPassword(
    user?.passwordHash ?? (await getDummyHash()),
    input.password,
  );
  if (!user || !user.passwordHash || !verified) {
    await recordAuthAttempt(db, "login", email, ctx.ip, now);
    return { ok: false, code: "invalid_credentials" };
  }
  if (user.status === "blocked") {
    return { ok: false, code: "blocked" };
  }

  const geo = await lookupIp(ctx.ip);

  const { token, device } = await db.$transaction(async (tx) => {
    await clearAuthAttempts(tx, "login", email, ctx.ip);

    // Lazy status flip: the daily worker arrives at stage 9, but an overdue
    // account must land on /expired starting from this very login (spec 7.1.5).
    if (
      user.role === "student" &&
      user.status === "active" &&
      user.accessUntil !== null &&
      user.accessUntil <= now
    ) {
      await tx.user.update({ where: { id: user.id }, data: { status: "expired" } });
      await pauseStreak(tx, user.id); // spec 7.1.5/7.7: серия на паузе, не сгорает
      await emitEvent(tx, "access.expired", { via: "login" }, { userId: user.id });
      user.status = "expired";
    }

    const device = await registerDevice(tx, {
      userId: user.id,
      deviceCookieId: ctx.deviceCookieId,
      userAgent: ctx.userAgent,
      now,
    });

    // Spec 7.2: one concurrent session — every other live session is displaced.
    await revokeSessions(tx, { userId: user.id, reason: "evicted_login", now });

    const { token } = await createSession(tx, {
      userId: user.id,
      deviceId: device.deviceId,
      ip: ctx.ip,
      city: geo?.city ?? null,
      country: geo?.country ?? null,
      now,
    });

    await tx.user.update({ where: { id: user.id }, data: { lastSeenAt: now } });
    await emitEvent(
      tx,
      "auth.login",
      { ip: ctx.ip, city: geo?.city ?? null, device: device.label },
      { userId: user.id },
    );
    return { token, device };
  });

  // Spec 7.12 (new_device): email on every new device. The very first device is
  // the account's own activation — notifying about it would be noise.
  if (device.isNew && device.hadOtherDevices) {
    await sendNewDeviceEmail(user.email, device.label);
  }

  const geoCheck = await checkGeoAnomalyOnLogin(db, { user, ip: ctx.ip, geo, now });
  if (geoCheck.blocked) {
    return { ok: false, code: "blocked" };
  }

  return { ok: true, token, deviceCookieId: device.deviceCookieId, user };
}

export async function logout(
  db: Db,
  session: SessionWithUser,
  now: Date = new Date(),
): Promise<void> {
  await revokeSessionById(db, session.id, "logout", now);
}

// --- Invite acceptance (spec 7.1.1) ---

export type InviteValidation =
  | { state: "valid"; invite: Invite; user: User }
  | { state: "expired" }
  | { state: "used" }
  | { state: "invalid" };

export async function validateInviteToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<InviteValidation> {
  if (!token) return { state: "invalid" };
  const invite = await db.invite.findUnique({ where: { token } });
  if (!invite) return { state: "invalid" };
  if (invite.acceptedAt) return { state: "used" };
  if (invite.expiresAt <= now) return { state: "expired" };
  const user = await db.user.findUnique({ where: { email: invite.email } });
  if (!user) return { state: "invalid" };
  if (user.status !== "invited") return { state: "used" };
  return { state: "valid", invite, user };
}

export type AcceptInviteResult =
  ({ ok: true } & AuthedSession) | { ok: false; code: "invalid" | "expired" | "used" };

/** Sets the password, activates the 90-day access window and logs the student in. */
export async function acceptInvite(
  db: PrismaClient,
  input: { token: string; password: string },
  ctx: RequestContext,
): Promise<AcceptInviteResult> {
  const now = ctx.now ?? new Date();
  const validation = await validateInviteToken(db, input.token, now);
  if (validation.state !== "valid") {
    return { ok: false, code: validation.state };
  }
  const { invite, user } = validation;
  const passwordHash = await hashPassword(input.password);

  const { token, device } = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: "active",
        activatedAt: now,
        // Spec 7.1.1: отсчёт 90 дней — с установки пароля, не с инвайта. Только
        // ученики имеют срок доступа; приглашённый ментор активируется без него.
        accessUntil: user.role === "student" ? addDays(now, ACCESS_INITIAL_DAYS) : null,
        lastSeenAt: now,
      },
    });
    await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: now } });
    const device = await registerDevice(tx, {
      userId: user.id,
      deviceCookieId: ctx.deviceCookieId,
      userAgent: ctx.userAgent,
      now,
    });
    const { token } = await createSession(tx, {
      userId: user.id,
      deviceId: device.deviceId,
      ip: ctx.ip,
      now,
    });
    await emitEvent(tx, "auth.login", { ip: ctx.ip, via: "invite" }, { userId: user.id });
    return { token, device };
  });

  const freshUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  return { ok: true, token, deviceCookieId: device.deviceCookieId, user: freshUser };
}

// --- Password reset (spec 8.1: стандартный сброс) ---

export type RequestResetResult = { ok: true } | { ok: false; code: "rate_limited" };

/** Always answers neutrally — must not reveal whether the email exists (spec 11). */
export async function requestPasswordReset(
  db: Db,
  input: { email: string },
  ctx: { ip: string; now?: Date },
): Promise<RequestResetResult> {
  const now = ctx.now ?? new Date();
  if (await isAuthRateLimited(db, "forgot", input.email, ctx.ip, now)) {
    return { ok: false, code: "rate_limited" };
  }
  // Every request consumes budget — /forgot has no success/failure distinction.
  await recordAuthAttempt(db, "forgot", input.email, ctx.ip, now);

  const user = await db.user.findUnique({ where: { email: input.email } });
  if (user?.passwordHash) {
    const token = generateToken();
    await db.passwordReset.create({
      data: {
        userId: user.id,
        // Reset tokens are stored hashed (spec 11) — the raw value lives only in the link.
        token: sha256Hex(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        createdAt: now,
      },
    });
    await sendPasswordResetEmail(user.email, `${env.platformUrl}/reset/${token}`);
  }
  return { ok: true };
}

export async function isResetTokenValid(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token) return false;
  const reset = await db.passwordReset.findUnique({ where: { token: sha256Hex(token) } });
  return reset !== null && reset.usedAt === null && reset.expiresAt > now;
}

export type ResetPasswordResult = { ok: true } | { ok: false; code: "invalid" };

export async function resetPassword(
  db: PrismaClient,
  input: { token: string; password: string },
  now: Date = new Date(),
): Promise<ResetPasswordResult> {
  const reset = await db.passwordReset.findUnique({
    where: { token: sha256Hex(input.token) },
    include: { user: true },
  });
  if (!reset || reset.usedAt !== null || reset.expiresAt <= now) {
    return { ok: false, code: "invalid" };
  }
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    await tx.passwordReset.update({ where: { id: reset.id }, data: { usedAt: now } });
    // Safety: a reset invalidates every existing login.
    await revokeSessions(tx, {
      userId: reset.userId,
      reason: "password_reset",
      includeImpersonated: false,
      now,
    });
  });
  return { ok: true };
}

export type ChangePasswordResult = { ok: true } | { ok: false; code: "invalid_old" };

export async function changePassword(
  db: PrismaClient,
  input: { user: User; currentSessionId: string; oldPassword: string; newPassword: string },
  now: Date = new Date(),
): Promise<ChangePasswordResult> {
  if (
    !input.user.passwordHash ||
    !(await verifyPassword(input.user.passwordHash, input.oldPassword))
  ) {
    return { ok: false, code: "invalid_old" };
  }
  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.user.id }, data: { passwordHash } });
    // Other logins are dropped; the session that changed the password survives.
    await revokeSessions(tx, {
      userId: input.user.id,
      reason: "password_change",
      exceptSessionId: input.currentSessionId,
      now,
    });
  });
  return { ok: true };
}
