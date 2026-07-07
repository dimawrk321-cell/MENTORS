import type { PrismaClient, User } from "@prisma/client";
import type { Db } from "@/lib/db";
import { env } from "@/lib/env";
import { addDays, DAY_MS, daysUntil, formatDateRu, zonedDateEndUtc } from "@/lib/utils/dates";
import { generateToken, paletteIndex } from "@/lib/utils/crypto";
import { emitEvent } from "@/lib/services/events";
import { writeAudit } from "@/lib/services/audit";
import { revokeSessions } from "@/lib/services/sessions";
import { sendAccessExpiryReminderEmail, sendInviteEmail } from "@/lib/services/mail";

// Student access lifecycle (spec 7.1): manual invite, 90 days from activation,
// extensions that never eat dead days, soft-lock on expiry.

export const ACCESS_INITIAL_DAYS = 90;
export { EXTENSION_MONTH_DAYS } from "@/lib/constants";
export const INVITE_TTL_DAYS = 7;
export const EXPIRY_REMINDER_DAYS = [14, 3, 0] as const;

// --- Pure date rules (unit-tested) ---

export function computeInitialAccessUntil(now: Date): Date {
  return addDays(now, ACCESS_INITIAL_DAYS);
}

/** Spec 7.1.7: new_access_until = max(today, access_until) + срок. */
export function computeExtendedAccessUntil(now: Date, current: Date | null, days: number): Date {
  const base = current !== null && current > now ? current : now;
  return addDays(base, days);
}

/** Days recorded for a «до даты» extension; ≤0 means the date is not in the future. */
export function daysForTargetDate(now: Date, current: Date | null, target: Date): number {
  const base = current !== null && current > now ? current : now;
  return Math.ceil((target.getTime() - base.getTime()) / DAY_MS);
}

export function shouldExpire(
  user: Pick<User, "role" | "status" | "accessUntil">,
  now: Date,
): boolean {
  return (
    user.role === "student" &&
    user.status === "active" &&
    user.accessUntil !== null &&
    user.accessUntil <= now
  );
}

// --- Invite flow (spec 7.1.1 + changelog: link is shown in the admin UI) ---

export type InviteStudentResult =
  | { ok: true; userId: string; inviteUrl: string }
  | { ok: false; code: "exists" | "already_invited" };

export function inviteUrlFor(token: string): string {
  return `${env.platformUrl}/invite/${token}`;
}

export async function inviteStudent(
  db: PrismaClient,
  input: { actorId: string; email: string; name: string; now?: Date },
): Promise<InviteStudentResult> {
  const now = input.now ?? new Date();
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) {
    return { ok: false, code: existing.status === "invited" ? "already_invited" : "exists" };
  }

  // DECISION: invite tokens are stored raw (unlike sessions/resets) — the spec
  // changelog requires the link to stay visible in the admin UI after creation.
  // Single-use, 7-day TTL, revocable by resend keeps the risk contained.
  const token = generateToken();
  const { user } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        role: "student",
        status: "invited",
        avatarColor: paletteIndex(input.email),
      },
    });
    await tx.invite.create({
      data: {
        email: input.email,
        token,
        invitedById: input.actorId,
        expiresAt: addDays(now, INVITE_TTL_DAYS),
        createdAt: now,
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "student.invited",
      entityType: "user",
      entityId: user.id,
      after: { email: input.email, name: input.name },
    });
    return { user };
  });

  await sendInviteEmail(input.email, input.name, inviteUrlFor(token));
  return { ok: true, userId: user.id, inviteUrl: inviteUrlFor(token) };
}

export type ResendInviteResult =
  { ok: true; inviteUrl: string } | { ok: false; code: "not_invited" };

/** Regenerates the token and 7-day TTL for a still-invited student. */
export async function resendInvite(
  db: PrismaClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<ResendInviteResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.role !== "student" || user.status !== "invited") {
    return { ok: false, code: "not_invited" };
  }

  const token = generateToken();
  await db.$transaction(async (tx) => {
    const latest = await tx.invite.findFirst({
      where: { email: user.email, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (latest) {
      await tx.invite.update({
        where: { id: latest.id },
        data: { token, expiresAt: addDays(now, INVITE_TTL_DAYS), invitedById: input.actorId },
      });
    } else {
      await tx.invite.create({
        data: {
          email: user.email,
          token,
          invitedById: input.actorId,
          expiresAt: addDays(now, INVITE_TTL_DAYS),
          createdAt: now,
        },
      });
    }
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "student.invite_resent",
      entityType: "user",
      entityId: user.id,
    });
  });

  await sendInviteEmail(user.email, user.name, inviteUrlFor(token));
  return { ok: true, inviteUrl: inviteUrlFor(token) };
}

/** Current (pending) invite link for the student card, if any. */
export async function getPendingInvite(db: Db, user: User, now: Date = new Date()) {
  if (user.status !== "invited") return null;
  const invite = await db.invite.findFirst({
    where: { email: user.email, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!invite) return null;
  return {
    url: inviteUrlFor(invite.token),
    expiresAt: invite.expiresAt,
    expired: invite.expiresAt <= now,
  };
}

// --- Extensions (spec 7.1.7) ---

export type ExtendAccessResult =
  | { ok: true; newAccessUntil: Date }
  | { ok: false; code: "not_found" | "not_activated" | "date_not_future" };

export async function extendAccess(
  db: PrismaClient,
  input: {
    actorId: string;
    userId: string;
    /** «until» carries the YYYY-MM-DD date; it ends in the student's timezone. */
    term: { kind: "days"; days: number } | { kind: "until"; date: string };
    comment?: string;
    now?: Date;
  },
): Promise<ExtendAccessResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.role !== "student") return { ok: false, code: "not_found" };
  // Extension needs a started countdown: инвайт ещё не принят — продлевать нечего.
  if (user.status === "invited" || user.accessUntil === null) {
    return { ok: false, code: "not_activated" };
  }

  let days: number;
  let newAccessUntil: Date;
  if (input.term.kind === "days") {
    days = input.term.days;
    newAccessUntil = computeExtendedAccessUntil(now, user.accessUntil, days);
  } else {
    const target = zonedDateEndUtc(input.term.date, user.timezone);
    days = daysForTargetDate(now, user.accessUntil, target);
    if (days <= 0) return { ok: false, code: "date_not_future" };
    newAccessUntil = target;
  }

  await db.$transaction(async (tx) => {
    await tx.accessExtension.create({
      data: {
        userId: user.id,
        days,
        newAccessUntil,
        grantedById: input.actorId,
        comment: input.comment ?? null,
        createdAt: now,
      },
    });
    // Spec 7.1.7: extension reactivates (blocked/expired → active); bookings are
    // not restored (nothing to restore before stage 6); streak unpause — stage 5.
    await tx.user.update({
      where: { id: user.id },
      data: { accessUntil: newAccessUntil, status: "active" },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "access.extended",
      entityType: "user",
      entityId: user.id,
      before: { status: user.status, accessUntil: user.accessUntil?.toISOString() ?? null },
      after: { status: "active", accessUntil: newAccessUntil.toISOString(), days },
    });
    await emitEvent(
      tx,
      "access.extended",
      { days, comment: input.comment ?? null },
      { userId: user.id },
    );
  });

  return { ok: true, newAccessUntil };
}

// --- Expiry (spec 7.1.5): status flip; scheduled by the stage-9 worker ---

/** Flips overdue active students to expired. Booking cancellation joins at stage 6. */
export async function expireOverdueAccess(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const overdue = await db.user.findMany({
    where: { role: "student", status: "active", accessUntil: { lte: now } },
    select: { id: true },
  });
  for (const { id } of overdue) {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: "expired" } });
      await emitEvent(tx, "access.expired", { via: "worker" }, { userId: id });
    });
  }
  return overdue.length;
}

/**
 * Expiry reminders for 14/3/0 days left (spec 7.1.3).
 * DECISION: stage-1 stub — sends via the dev-log mailer when called; the
 * stage-9 worker (expiryNotify) will schedule it daily and add the in-app bell.
 */
export async function sendAccessExpiryReminders(db: Db, now: Date = new Date()): Promise<number> {
  const students = await db.user.findMany({
    where: { role: "student", status: "active", accessUntil: { not: null } },
  });
  let sent = 0;
  for (const student of students) {
    const left = daysUntil(student.accessUntil!, now);
    if ((EXPIRY_REMINDER_DAYS as readonly number[]).includes(left)) {
      await sendAccessExpiryReminderEmail(
        student.email,
        formatDateRu(student.accessUntil!, student.timezone),
      );
      sent += 1;
    }
  }
  return sent;
}

/** Totals for the /expired farewell screen (spec 7.1.6). */
export async function getExpiredSummary(db: Db, userId: string) {
  // DECISION: lessons/XP/streak/mocks tables arrive at stages 2/5/5/6 — until
  // then the summary is zeros from this single point; each stage wires its source here.
  void db;
  void userId;
  return { lessonsCompleted: 0, totalXp: 0, bestStreak: 0, mocksCompleted: 0 };
}

// --- Admin: block / unblock / reset sessions (spec 2, 7.1.8) ---

export type AdminUserActionResult =
  { ok: true } | { ok: false; code: "not_found" | "wrong_status" };

export async function blockStudent(
  db: PrismaClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<AdminUserActionResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.role !== "student") return { ok: false, code: "not_found" };
  if (user.status === "blocked") return { ok: false, code: "wrong_status" };

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: "blocked" } });
    // Spec 7.1.8: мгновенный разлогин всех сессий.
    await revokeSessions(tx, {
      userId: user.id,
      reason: "blocked",
      includeImpersonated: true,
      now,
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "user.blocked",
      entityType: "user",
      entityId: user.id,
      before: { status: user.status },
      after: { status: "blocked" },
    });
  });
  return { ok: true };
}

// DECISION: spec defines block but no explicit unblock; restoring by dates
// (active while access remains, expired otherwise) is the minimal reversal —
// extension also unblocks per 7.1.7.
export async function unblockStudent(
  db: PrismaClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<AdminUserActionResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.role !== "student") return { ok: false, code: "not_found" };
  if (user.status !== "blocked") return { ok: false, code: "wrong_status" };

  const restored =
    user.activatedAt === null
      ? "invited"
      : user.accessUntil !== null && user.accessUntil > now
        ? "active"
        : "expired";

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: restored } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "user.unblocked",
      entityType: "user",
      entityId: user.id,
      before: { status: "blocked" },
      after: { status: restored },
    });
  });
  return { ok: true };
}

/** «Сбросить сессии и устройства» in the student card. */
export async function adminResetSessions(
  db: PrismaClient,
  input: { actorId: string; userId: string; now?: Date },
): Promise<AdminUserActionResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.role !== "student") return { ok: false, code: "not_found" };

  await db.$transaction(async (tx) => {
    await revokeSessions(tx, {
      userId: user.id,
      reason: "admin_reset",
      includeImpersonated: true,
      now,
    });
    await tx.device.deleteMany({ where: { userId: user.id } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "sessions.reset",
      entityType: "user",
      entityId: user.id,
    });
  });
  return { ok: true };
}

// --- Admin queries for /admin/students ---

export async function listStudents(db: Db, query?: string) {
  return db.user.findMany({
    where: {
      role: "student",
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    // DECISION: plain limit is enough for the current cohort (~25); cursor
    // pagination lands with the full students table at stage 10 (spec 12).
    take: 50,
  });
}

export async function getStudentDetail(db: Db, userId: string, now: Date = new Date()) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      devices: { orderBy: { lastSeenAt: "desc" } },
      accessExtensions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { grantedBy: { select: { name: true } } },
      },
    },
  });
  if (!user || user.role !== "student") return null;
  const sessions = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now }, impersonatorId: null },
    orderBy: { lastActiveAt: "desc" },
  });
  const invite = await getPendingInvite(db, user, now);
  return { user, sessions, invite };
}
