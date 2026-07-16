import type { Booking, MockType, PrismaClient, WaitlistStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { isRoomUrlReady } from "@/lib/constants";
import { writeAudit } from "@/lib/services/audit";
import { computeBookingLock, type BookingLock } from "@/lib/services/mocks";

// Админ-интервью (spec 8.5): все брони с фильтрами, страйки и локи (снятие
// страйка с аудитом), waitlist, редактор профилей интервьюеров. Рубрики — в
// feedback.ts (upsertRubricTemplate).

export interface AdminBookingRow {
  bookingId: string;
  type: MockType;
  status: Booking["status"];
  startsAt: Date;
  studentId: string;
  studentName: string;
  interviewerName: string;
  verdict: string | null;
}

export type BookingStatusFilter = Booking["status"] | "all";

/** Все брони с фильтром по статусу (spec 8.5). */
export async function listAllBookings(
  db: Db,
  input: { status?: BookingStatusFilter; take?: number } = {},
): Promise<AdminBookingRow[]> {
  const bookings = await db.booking.findMany({
    where: input.status && input.status !== "all" ? { status: input.status } : {},
    include: {
      slot: { include: { interviewer: { select: { name: true } } } },
      user: { select: { id: true, name: true } },
      feedback: { select: { verdict: true, status: true } },
    },
    orderBy: { slot: { startsAt: "desc" } },
    take: input.take ?? 100,
  });
  return bookings.map((booking) => ({
    bookingId: booking.id,
    type: booking.type,
    status: booking.status,
    startsAt: booking.slot.startsAt,
    studentId: booking.user.id,
    studentName: booking.user.name,
    interviewerName: booking.slot.interviewer.name,
    verdict: booking.feedback?.status === "published" ? booking.feedback.verdict : null,
  }));
}

export interface StudentStrikeSummary {
  studentId: string;
  studentName: string;
  strikes: Array<{ id: string; reason: string; createdAt: Date; bookingId: string }>;
  lock: BookingLock | null;
}

/** Страйки и локи по ученикам (spec 8.5). Показываются только ученики со страйками. */
export async function listStrikesWithLocks(
  db: Db,
  now: Date = new Date(),
): Promise<StudentStrikeSummary[]> {
  const strikes = await db.bookingStrike.findMany({
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const byStudent = new Map<string, StudentStrikeSummary>();
  for (const strike of strikes) {
    const entry = byStudent.get(strike.userId) ?? {
      studentId: strike.userId,
      studentName: strike.user.name,
      strikes: [],
      lock: null,
    };
    entry.strikes.push({
      id: strike.id,
      reason: strike.reason,
      createdAt: strike.createdAt,
      bookingId: strike.bookingId,
    });
    byStudent.set(strike.userId, entry);
  }
  for (const entry of byStudent.values()) {
    entry.lock = computeBookingLock(
      entry.strikes.map((s) => ({
        reason: s.reason as "late_cancel" | "no_show",
        createdAt: s.createdAt,
      })),
      now,
    );
  }
  return [...byStudent.values()].sort((a, b) => b.strikes.length - a.strikes.length);
}

export type RemoveStrikeResult = { ok: true } | { ok: false; code: "not_found" };

/** Снятие страйка вручную с аудитом (spec 8.5). */
export async function removeStrike(
  db: PrismaClient,
  input: { actorId: string; strikeId: string },
): Promise<RemoveStrikeResult> {
  const strike = await db.bookingStrike.findUnique({ where: { id: input.strikeId } });
  if (!strike) return { ok: false, code: "not_found" };
  await db.$transaction(async (tx) => {
    await tx.bookingStrike.delete({ where: { id: input.strikeId } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "mock.strike_removed",
      entityType: "booking_strike",
      entityId: input.strikeId,
      before: { userId: strike.userId, reason: strike.reason, bookingId: strike.bookingId },
    });
  });
  return { ok: true };
}

export interface AdminWaitlistRow {
  id: string;
  studentName: string;
  type: MockType;
  interviewerName: string | null;
  status: WaitlistStatus;
  untilDate: Date;
  offerExpiresAt: Date | null;
}

/** Waitlist для админки (spec 8.5). */
export async function listWaitlist(db: Db): Promise<AdminWaitlistRow[]> {
  const entries = await db.waitlist.findMany({
    where: { status: { in: ["waiting", "offered"] } },
    include: {
      user: { select: { name: true } },
      interviewer: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  return entries.map((entry) => ({
    id: entry.id,
    studentName: entry.user.name,
    type: entry.type,
    interviewerName: entry.interviewer?.name ?? null,
    status: entry.status,
    untilDate: entry.untilDate,
    offerExpiresAt: entry.offerExpiresAt,
  }));
}

// --- Профиль интервьюера (spec 7.8/8.5): room_url, bio, active ---

export interface InterviewerProfileView {
  userId: string;
  name: string;
  roomUrl: string;
  bio: string | null;
  active: boolean;
}

/** Профили всех интервьюеров для редактора (spec 8.5). */
export async function listInterviewerProfiles(db: Db): Promise<InterviewerProfileView[]> {
  const users = await db.user.findMany({
    where: { isInterviewer: true },
    include: { interviewerProfile: true },
    orderBy: { createdAt: "asc" },
  });
  return users.map((user) => ({
    userId: user.id,
    name: user.name,
    roomUrl: user.interviewerProfile?.roomUrl ?? "",
    bio: user.interviewerProfile?.bio ?? null,
    active: user.interviewerProfile?.active ?? false,
  }));
}

export async function getInterviewerProfile(
  db: Db,
  userId: string,
): Promise<InterviewerProfileView | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { interviewerProfile: true },
  });
  if (!user || !user.isInterviewer) return null;
  return {
    userId: user.id,
    name: user.name,
    roomUrl: user.interviewerProfile?.roomUrl ?? "",
    bio: user.interviewerProfile?.bio ?? null,
    active: user.interviewerProfile?.active ?? false,
  };
}

export type UpsertProfileResult = { ok: true } | { ok: false; code: "not_interviewer" };

/** Редактирование профиля интервьюера (spec 8.4/8.5): владельцем и самим интервьюером. */
export async function upsertInterviewerProfile(
  db: PrismaClient,
  input: {
    actorId: string;
    userId: string;
    roomUrl: string;
    bio?: string | null;
    active: boolean;
    now?: Date;
  },
): Promise<UpsertProfileResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { isInterviewer: true },
  });
  if (!user || !user.isInterviewer) return { ok: false, code: "not_interviewer" };

  await db.$transaction(async (tx) => {
    const before = await tx.interviewerProfile.findUnique({ where: { userId: input.userId } });
    await tx.interviewerProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        roomUrl: input.roomUrl,
        bio: input.bio ?? null,
        active: input.active,
      },
      update: { roomUrl: input.roomUrl, bio: input.bio ?? null, active: input.active },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "interviewer.profile_updated",
      entityType: "interviewer_profile",
      entityId: input.userId,
      before: before ? { roomUrl: before.roomUrl, active: before.active } : undefined,
      after: { roomUrl: input.roomUrl, active: input.active },
    });

    // Acceptance-фикс (в): при сохранении НАСТОЯЩЕЙ ссылки мигрируем её в будущие
    // booked-брони этого интервьюера, чтобы уже забронированные ученики не получили
    // мёртвую кнопку «Подключиться». Плейсхолдер в брони не переносим. Одна аудит-запись.
    if (isRoomUrlReady(input.roomUrl) && input.roomUrl !== before?.roomUrl) {
      const future = await tx.booking.findMany({
        where: {
          status: "booked",
          slot: { interviewerId: input.userId, startsAt: { gt: now } },
        },
        select: { id: true },
      });
      if (future.length > 0) {
        await tx.booking.updateMany({
          where: { id: { in: future.map((b) => b.id) } },
          data: { roomUrl: input.roomUrl },
        });
        await writeAudit(tx, {
          actorId: input.actorId,
          action: "interviewer.room_url_migrated",
          entityType: "interviewer_profile",
          entityId: input.userId,
          after: { roomUrl: input.roomUrl, bookingsUpdated: future.length },
        });
      }
    }
  });
  return { ok: true };
}
