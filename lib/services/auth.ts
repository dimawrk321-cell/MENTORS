import type { Invite, PrismaClient, User } from "@prisma/client";
import type { Db } from "@/lib/db";
import { addDays } from "@/lib/utils/dates";
import { sha256Hex, generateToken, generateTempPassword } from "@/lib/utils/crypto";
import { getDummyHash, hashPassword, verifyPassword } from "@/lib/utils/password";
import { clearAuthAttempts, isAuthRateLimited, recordAuthAttempt } from "@/lib/utils/rate-limit";
import { emitEvent } from "@/lib/services/events";
import { pauseStreak } from "@/lib/services/streak";
import { lookupIp } from "@/lib/services/geoip";
import { checkGeoAnomalyOnLogin } from "@/lib/services/security";
import { sendNewDeviceEmail, sendPasswordResetEmail } from "@/lib/services/mail";
import { writeAudit } from "@/lib/services/audit";
import {
  createSession,
  registerDevice,
  revokeSessionById,
  revokeSessions,
  type SessionWithUser,
} from "@/lib/services/sessions";
import { ACCESS_INITIAL_DAYS } from "@/lib/services/access";
import { issueEmailCode } from "@/lib/services/email-verification";
import { logger } from "@/lib/logger";
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
    // 13.2 audit: consume a rate-limit attempt here too, so a blocked account's
    // login is throttled identically to the invalid-credentials path — the
    // distinct «заблокирован» response can't be used as a FREE, unlimited
    // password-confirmation oracle. DECISION: the informative message is kept (a
    // genuinely blocked user must understand why login fails); the residual — a
    // now-rate-limited, message-based confirmation that already requires holding
    // a candidate password AND knowing the account is blocked — is accepted as low.
    await recordAuthAttempt(db, "login", email, ctx.ip, now);
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

    // Walk 12.4/A3: first successful login on admin-issued credentials activates
    // the account (status invited→active). DECISION: activation happens at this
    // first login — BEFORE the forced password change — so the 90-day clock
    // starts from the real first login (spec 7.1 «отсчёт с первого входа»); the
    // must_change_password flag stays set until the user picks their own password.
    // This flip is also REQUIRED: validateSessionToken rejects `invited` sessions,
    // so without it the freshly-created session would be dead on the next request.
    if (user.status === "invited") {
      const accessUntil = user.role === "student" ? addDays(now, ACCESS_INITIAL_DAYS) : null;
      await tx.user.update({
        where: { id: user.id },
        data: { status: "active", activatedAt: now, accessUntil },
      });
      await emitEvent(tx, "access.activated", { via: "login" }, { userId: user.id });
      user.status = "active";
      user.activatedAt = now;
      user.accessUntil = accessUntil;
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

  // Soft email verification (spec 12.1/C8): issue a 6-digit code on activation.
  // Non-blocking — a failure here must never break signup (verification is optional
  // and student-only; a mentor has no place to enter the code).
  if (freshUser.role === "student") {
    try {
      await issueEmailCode(db, freshUser.id, now);
    } catch (err) {
      logger.error({ err, userId: freshUser.id }, "issueEmailCode failed (non-fatal)");
    }
  }

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

export type AdminResetPasswordResult =
  | { ok: true; tempPassword: string; email: string }
  | { ok: false; code: "not_found" | "not_eligible" };

/**
 * Admin password reset to a temporary password (walk 12.4/A2). Replaces the
 * link-based admin reset in the UI (the link mechanism now serves only self-serve
 * «Забыл пароль» — requestPasswordReset). Sets a fresh temp password + forces the
 * «Придумай свой пароль» screen (must_change_password); the plaintext is returned
 * for a one-time display and NEVER persisted or audited (only the argon2 hash).
 * Any pending self-serve reset links are invalidated. Sessions are NOT revoked —
 * that is a separate button. Eligible for a student with a password who is not
 * blocked (active | expired | invited-with-credentials); a legacy invited student
 * without a password is not eligible.
 */
export async function adminResetPasswordToTemp(
  db: PrismaClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<AdminResetPasswordResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.role !== "student") return { ok: false, code: "not_found" };
  if (!user.passwordHash || user.status === "blocked") {
    return { ok: false, code: "not_eligible" };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true },
    });
    // Any outstanding self-serve reset links are moot now.
    await tx.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
    // Audit carries NO secret (like password_reset.issued before it).
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "password.reset_to_temp",
      entityType: "user",
      entityId: user.id,
    });
  });

  return { ok: true, tempPassword, email: user.email };
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

/**
 * Forced initial password (walk 12.4/A2): the «Придумай свой пароль» screen. No
 * old-password check — the user is already session-authed and pinned to this
 * screen by must_change_password. Sets the new hash, clears the flag, and drops
 * every other login (like changePassword) keeping the current session.
 */
export async function setInitialPassword(
  db: PrismaClient,
  input: { user: User; currentSessionId: string; newPassword: string },
  now: Date = new Date(),
): Promise<void> {
  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await revokeSessions(tx, {
      userId: input.user.id,
      reason: "password_change",
      exceptSessionId: input.currentSessionId,
      now,
    });
  });
}
