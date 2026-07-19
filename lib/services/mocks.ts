import type { Booking, BookingStrike, MockMark, MockType, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  addDays,
  addMinutes,
  DAY_MS,
  dateOnlyUtc,
  formatDateTimeRu,
  localDateStr,
  zonedDayUtcRange,
} from "@/lib/utils/dates";
import {
  CANCEL_FREE_HOURS,
  NO_SHOW_AFTER_MINUTES,
  STRIKE_LOCK_DAYS,
  STRIKE_WINDOW_DAYS,
  WAITLIST_TTL_DAYS,
  OFFER_HOLD_HOURS,
} from "@/lib/constants";
import { emitEvent } from "@/lib/services/events";
import { notify } from "@/lib/services/notifications";
import { addSrsCardForFailure } from "@/lib/services/srs";
import { completeLesson } from "@/lib/services/content";
import { writeAudit } from "@/lib/services/audit";
import {
  getNumericSetting,
  OPS_CANCEL_FREE_HOURS_KEY,
  OPS_STRIKE_LOCK_DAYS_KEY,
} from "@/lib/services/settings";

// Мок-интервью (spec 7.8): бронирование (транзакция + SELECT FOR UPDATE), отмены и
// страйки, лок бронирования, waitlist с hold 2 часа, экран проведения, завершение
// мока (+200 XP через диспетчер, отметки → SRS, закрытие мок-урока). Генерация
// слотов и расписание — в slots.ts; рубрики и фидбек — в feedback.ts.

const HOUR_MS = 60 * 60 * 1000;

// --- Страйки и лок бронирования (spec 7.8) ---

export interface BookingLock {
  lockedUntil: Date;
  /** Страйки за скользящее окно 60 дней — для текста причины. */
  recentStrikes: Pick<BookingStrike, "reason" | "createdAt">[];
}

/**
 * Лок бронирования (spec 7.8): 2 страйка за скользящие 60 дней → блок на 14 дней.
 * Чистая функция. Страйки сортируются по времени; лок запускает каждый страйк,
 * у которого есть предыдущий страйк в пределах 60 дней (ближайший предыдущий —
 * соседний в сортировке, поэтому достаточно проверить пары). Дата разблокировки —
 * позднейший из concluding-страйк + 14 дней; активен, если она в будущем.
 */
export function computeBookingLock(
  strikes: Pick<BookingStrike, "reason" | "createdAt">[],
  now: Date,
  lockDays: number = STRIKE_LOCK_DAYS,
): BookingLock | null {
  const ordered = [...strikes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let lockedUntil: Date | null = null;
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i]!.createdAt.getTime() - ordered[i - 1]!.createdAt.getTime();
    if (gap <= STRIKE_WINDOW_DAYS * DAY_MS) {
      const end = addDays(ordered[i]!.createdAt, lockDays);
      if (!lockedUntil || end > lockedUntil) lockedUntil = end;
    }
  }
  if (!lockedUntil || lockedUntil <= now) return null;
  const windowStart = now.getTime() - STRIKE_WINDOW_DAYS * DAY_MS;
  const recentStrikes = ordered.filter((s) => s.createdAt.getTime() >= windowStart);
  return { lockedUntil, recentStrikes };
}

/** Текущий лок бронирования ученика (spec 7.8). null — можно бронировать. */
export async function getBookingLock(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<BookingLock | null> {
  const strikes = await db.bookingStrike.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { reason: true, createdAt: true },
  });
  const lockDays = await getNumericSetting(db, OPS_STRIKE_LOCK_DAYS_KEY, STRIKE_LOCK_DAYS, {
    min: 1,
    max: 365,
  });
  return computeBookingLock(strikes, now, lockDays);
}

// --- Waitlist (spec 7.8): заявки и hold-предложения ---

/** Приоритетный якорь createdAt для пострадавших от «Закрыть день»/отмены интервьюером.
 *  Waitlist сортируется по createdAt asc; пострадавшие встают раньше обычных заявок
 *  (в модели данных нет отдельной колонки приоритета — spec 6). */
const PRIORITY_ANCHOR = new Date("2000-01-01T00:00:00.000Z");

interface CandidateContext {
  now: Date;
  slotStartsAt: Date;
}

/** Может ли ученик получить предложение по слоту: активен, доступ покрывает слот,
 *  нет активной брони, нет лока (spec 7.8). */
async function isWaitlistCandidateEligible(
  db: Db,
  userId: string,
  ctx: CandidateContext,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true, accessUntil: true },
  });
  if (!user || user.role !== "student" || user.status !== "active") return false;
  if (user.accessUntil && ctx.slotStartsAt > user.accessUntil) return false;
  const active = await db.booking.count({
    where: { userId, status: "booked", slot: { startsAt: { gt: ctx.now } } },
  });
  if (active > 0) return false;
  return (await getBookingLock(db, userId, ctx.now)) === null;
}

/**
 * Освободившийся open-слот → первое подходящее ожидание (spec 7.8): подходит по
 * интервьюеру (null = любой) и не истёкшее по until_date; тип слот не ограничивает
 * (слот обслуживает любой тип). Кандидат ставится offered на 2 часа (hold), слот
 * недоступен другим. excludeUserId — не предлагать тому, у кого hold только истёк.
 */
export async function offerSlotToWaitlist(
  db: Db,
  input: { slotId: string; now?: Date; excludeUserId?: string },
): Promise<{ offered: boolean }> {
  const now = input.now ?? new Date();
  const slot = await db.slot.findUnique({ where: { id: input.slotId } });
  if (!slot || slot.status !== "open" || slot.startsAt <= now) return { offered: false };

  // Слот уже держится активным предложением — не переназначаем.
  const held = await db.waitlist.count({
    where: { offeredSlotId: slot.id, status: "offered", offerExpiresAt: { gt: now } },
  });
  if (held > 0) return { offered: false };

  const todayUtc = dateOnlyUtc(localDateStr(now, "UTC"));
  const candidates = await db.waitlist.findMany({
    where: {
      status: "waiting",
      untilDate: { gte: todayUtc },
      OR: [{ interviewerId: null }, { interviewerId: slot.interviewerId }],
      ...(input.excludeUserId ? { userId: { not: input.excludeUserId } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  for (const entry of candidates) {
    if (
      !(await isWaitlistCandidateEligible(db, entry.userId, { now, slotStartsAt: slot.startsAt }))
    ) {
      continue;
    }
    await db.waitlist.update({
      where: { id: entry.id },
      data: {
        status: "offered",
        offeredSlotId: slot.id,
        offerExpiresAt: new Date(now.getTime() + OFFER_HOLD_HOURS * HOUR_MS),
      },
    });
    await emitEvent(
      db,
      "waitlist.offered",
      { waitlistId: entry.id, slotId: slot.id, type: entry.type },
      { userId: entry.userId },
    );
    await notify(db, entry.userId, "waitlist_offer", {});
    return { offered: true };
  }
  return { offered: false };
}

/** Ставит существующие ожидания ученика в начало очереди (spec 7.8) либо создаёт
 *  приоритетное ожидание — пострадавшему от отмены интервьюером/«Закрыть день». */
async function prioritizeWaitlistForVictim(
  db: Db,
  input: { userId: string; type: MockType; now: Date },
): Promise<void> {
  const existing = await db.waitlist.findMany({
    where: { userId: input.userId, status: "waiting" },
    select: { id: true },
  });
  if (existing.length > 0) {
    await db.waitlist.updateMany({
      where: { id: { in: existing.map((e) => e.id) } },
      data: { createdAt: PRIORITY_ANCHOR },
    });
    return;
  }
  await db.waitlist.create({
    data: {
      userId: input.userId,
      type: input.type,
      interviewerId: null,
      untilDate: addDays(dateOnlyUtc(localDateStr(input.now, "UTC")), WAITLIST_TTL_DAYS),
      status: "waiting",
      createdAt: PRIORITY_ANCHOR,
    },
  });
}

export type JoinWaitlistResult =
  { ok: true; waitlistId: string; created: boolean } | { ok: false; code: "not_found" };

/** «Сообщить, когда появится слот» (spec 7.8): заявка (тип, интервьюер?, +14 дней). */
export async function joinWaitlist(
  db: PrismaClient,
  input: { userId: string; type: MockType; interviewerId?: string | null; now?: Date },
): Promise<JoinWaitlistResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { role: true, status: true },
  });
  if (!user || user.role !== "student" || user.status !== "active") {
    return { ok: false, code: "not_found" };
  }
  const interviewerId = input.interviewerId ?? null;
  const existing = await db.waitlist.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      interviewerId,
      status: { in: ["waiting", "offered"] },
    },
  });
  if (existing) return { ok: true, waitlistId: existing.id, created: false };

  const entry = await db.waitlist.create({
    data: {
      userId: input.userId,
      type: input.type,
      interviewerId,
      untilDate: addDays(dateOnlyUtc(localDateStr(now, "UTC")), WAITLIST_TTL_DAYS),
      status: "waiting",
    },
  });
  return { ok: true, waitlistId: entry.id, created: true };
}

export type ClaimOfferResult =
  | { ok: true; bookingId: string }
  | { ok: false; code: "not_found" | "expired" | "slot_taken" | "already_booked" | "locked" };

/** Клейм предложения из уведомления/страницы моков (spec 7.8). */
export async function claimOffer(
  db: PrismaClient,
  input: { userId: string; waitlistId: string; now?: Date },
): Promise<ClaimOfferResult> {
  const now = input.now ?? new Date();
  const entry = await db.waitlist.findUnique({ where: { id: input.waitlistId } });
  if (!entry || entry.userId !== input.userId || !entry.offeredSlotId) {
    return { ok: false, code: "not_found" };
  }
  if (entry.status !== "offered" || !entry.offerExpiresAt || entry.offerExpiresAt <= now) {
    return { ok: false, code: "expired" };
  }
  const booked = await bookMock(db, {
    userId: input.userId,
    slotId: entry.offeredSlotId,
    type: entry.type,
    now,
  });
  if (!booked.ok) {
    const code =
      booked.code === "already_booked"
        ? "already_booked"
        : booked.code === "locked"
          ? "locked"
          : "slot_taken";
    return { ok: false, code };
  }
  await db.$transaction(async (tx) => {
    await tx.waitlist.update({ where: { id: entry.id }, data: { status: "converted" } });
    await emitEvent(
      tx,
      "waitlist.converted",
      { waitlistId: entry.id, bookingId: booked.bookingId },
      { userId: input.userId },
    );
  });
  return { ok: true, bookingId: booked.bookingId };
}

/** Джоба waitlistHolds (spec 7.15, каждые 10 мин): истёкшие hold → следующему;
 *  заявки, просроченные по until_date → expired. Идемпотентна. */
export async function processWaitlistHolds(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ lapsed: number; expired: number }> {
  const lapsedOffers = await db.waitlist.findMany({
    where: { status: "offered", offerExpiresAt: { lte: now } },
  });
  for (const entry of lapsedOffers) {
    const slotId = entry.offeredSlotId;
    await db.waitlist.update({
      where: { id: entry.id },
      data: { status: "waiting", offeredSlotId: null, offerExpiresAt: null },
    });
    if (slotId) {
      await offerSlotToWaitlist(db, { slotId, now, excludeUserId: entry.userId });
    }
  }

  const todayUtc = dateOnlyUtc(localDateStr(now, "UTC"));
  const expired = await db.waitlist.updateMany({
    where: { status: "waiting", untilDate: { lt: todayUtc } },
    data: { status: "expired" },
  });
  return { lapsed: lapsedOffers.length, expired: expired.count };
}

// --- Бронирование (spec 7.8) ---

interface SlotLockRow {
  id: string;
  status: string;
  starts_at: Date;
  interviewer_id: string;
}

export type BookResult =
  | { ok: true; bookingId: string }
  | {
      ok: false;
      code:
        | "not_found"
        | "slot_taken"
        | "past"
        | "beyond_access"
        | "already_booked"
        | "locked"
        | "held"
        | "no_room";
    };

/**
 * Бронирование слота (spec 7.8). Транзакция с `SELECT … FOR UPDATE` слота
 * сериализует гонку на один слот (проигравший видит booked → slot_taken).
 * Проверки: слот open, старт в будущем и ≤ access_until, одна активная бронь,
 * нет booking-lock, нет чужого hold. room_url копируется в бронь. Эмит mock.booked.
 */
export async function bookMock(
  db: PrismaClient,
  input: { userId: string; slotId: string; type: MockType; now?: Date },
): Promise<BookResult> {
  const now = input.now ?? new Date();
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { role: true, status: true, accessUntil: true, name: true, timezone: true },
  });
  if (!user || user.role !== "student" || user.status !== "active") {
    return { ok: false, code: "not_found" };
  }

  return db.$transaction(async (tx) => {
    // Сериализуем брони одного ученика: без блокировки строки user две параллельные
    // брони на РАЗНЫЕ слоты (две вкладки) заблокировали бы разные строки slots и
    // обе увидели бы active=0 — обход правила «одна активная бронь» (spec 7.8).
    // Порядок блокировок всегда user → slot (иных путей, лочащих users, нет) — без дедлоков.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;

    const rows = await tx.$queryRaw<SlotLockRow[]>`
      SELECT id, status, starts_at, interviewer_id
      FROM slots WHERE id = ${input.slotId} FOR UPDATE`;
    const slot = rows[0];
    if (!slot) return { ok: false, code: "not_found" };
    if (slot.status !== "open") return { ok: false, code: "slot_taken" };
    if (slot.starts_at <= now) return { ok: false, code: "past" };
    if (user.accessUntil && slot.starts_at > user.accessUntil) {
      return { ok: false, code: "beyond_access" };
    }

    const active = await tx.booking.count({
      where: { userId: input.userId, status: "booked", slot: { startsAt: { gt: now } } },
    });
    if (active > 0) return { ok: false, code: "already_booked" };

    if ((await getBookingLock(tx, input.userId, now)) !== null) {
      return { ok: false, code: "locked" };
    }

    const heldForOther = await tx.waitlist.count({
      where: {
        offeredSlotId: input.slotId,
        status: "offered",
        offerExpiresAt: { gt: now },
        userId: { not: input.userId },
      },
    });
    if (heldForOther > 0) return { ok: false, code: "held" };

    const profile = await tx.interviewerProfile.findUnique({
      where: { userId: slot.interviewer_id },
    });
    // Acceptance-фикс: бронь разрешена даже с незаполненным/плейсхолдерным room_url —
    // копия попадёт в бронь, а UI покажет «Комната не указана». Когда интервьюер
    // сохранит настоящую ссылку, она мигрирует в будущие booked-брони (upsertInterviewerProfile).
    if (!profile || !profile.active) return { ok: false, code: "no_room" };

    await tx.slot.update({ where: { id: input.slotId }, data: { status: "booked" } });
    const booking = await tx.booking.create({
      data: {
        slotId: input.slotId,
        userId: input.userId,
        type: input.type,
        status: "booked",
        roomUrl: profile.roomUrl,
        createdAt: now,
      },
    });
    await emitEvent(
      tx,
      "mock.booked",
      { bookingId: booking.id, type: input.type, interviewerId: slot.interviewer_id },
      { userId: input.userId },
    );
    // Подтверждение брони обоим (spec 7.8/7.12, mock_booked — всегда включён).
    const interviewer = await tx.user.findUnique({
      where: { id: slot.interviewer_id },
      select: { timezone: true },
    });
    const interviewerTz = interviewer?.timezone ?? "Europe/Moscow";
    // emailDeadline = mock start: a booking confirmation past the mock is useless.
    await notify(
      tx,
      input.userId,
      "mock_booked",
      {
        role: "student",
        bookingId: booking.id,
        whenText: formatDateTimeRu(slot.starts_at, user.timezone),
        mockType: input.type,
      },
      { emailDeadline: slot.starts_at },
    );
    await notify(
      tx,
      slot.interviewer_id,
      "mock_booked",
      {
        role: "interviewer",
        whenText: formatDateTimeRu(slot.starts_at, interviewerTz),
        mockType: input.type,
        studentName: user.name,
      },
      { emailDeadline: slot.starts_at },
    );
    return { ok: true, bookingId: booking.id };
  });
}

// --- Отмены и страйки (spec 7.8) ---

export interface CancelPreview {
  /** true — до старта меньше 24 часов: отмена засчитает страйк (spec 7.8). */
  late: boolean;
}

export type CancelBookingResult =
  | { ok: true; late: boolean; strikeIssued: boolean }
  | { ok: false; code: "not_found" | "not_cancellable" };

/**
 * Отмена брони учеником (spec 7.8). ≥24ч — свободно; <24ч — страйк late_cancel.
 * Будущий слот открывается и уходит в waitlist (в обоих случаях). Прошедший слот
 * не переоткрывается.
 */
export async function cancelBooking(
  db: PrismaClient,
  input: { userId: string; bookingId: string; now?: Date },
): Promise<CancelBookingResult> {
  const now = input.now ?? new Date();
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: true },
  });
  if (!booking || booking.userId !== input.userId) return { ok: false, code: "not_found" };
  if (booking.status !== "booked") return { ok: false, code: "not_cancellable" };

  const cancelFreeHours = await getNumericSetting(
    db,
    OPS_CANCEL_FREE_HOURS_KEY,
    CANCEL_FREE_HOURS,
    {
      min: 0,
      max: 168,
    },
  );
  const late = booking.slot.startsAt.getTime() - now.getTime() < cancelFreeHours * HOUR_MS;
  const freesSlot = booking.slot.startsAt > now;

  await db.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled_student", cancelledAt: now },
    });
    if (freesSlot) {
      await tx.slot.update({ where: { id: booking.slotId }, data: { status: "open" } });
    }
    if (late) {
      await tx.bookingStrike.create({
        data: {
          userId: input.userId,
          bookingId: booking.id,
          reason: "late_cancel",
          createdAt: now,
        },
      });
    }
    await emitEvent(
      tx,
      "mock.cancelled",
      { bookingId: booking.id, by: "student", late },
      { userId: input.userId },
    );
    await notify(tx, booking.slot.interviewerId, "mock_cancelled", {
      audience: "interviewer",
      by: "student",
    });
    if (freesSlot) {
      await offerSlotToWaitlist(tx, { slotId: booking.slotId, now });
    }
  });

  return { ok: true, late, strikeIssued: late };
}

export type NoShowResult =
  { ok: true } | { ok: false; code: "not_found" | "too_early" | "not_bookable" };

/** «Не пришёл» (spec 7.8): активна через 10 мин после старта → no_show + страйк. */
export async function markNoShow(
  db: PrismaClient,
  input: { interviewerId: string; bookingId: string; now?: Date },
): Promise<NoShowResult> {
  const now = input.now ?? new Date();
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: true },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) {
    return { ok: false, code: "not_found" };
  }
  if (booking.status !== "booked") return { ok: false, code: "not_bookable" };
  if (now < addMinutes(booking.slot.startsAt, NO_SHOW_AFTER_MINUTES)) {
    return { ok: false, code: "too_early" };
  }

  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: "no_show" } });
    await tx.bookingStrike.create({
      data: { userId: booking.userId, bookingId: booking.id, reason: "no_show", createdAt: now },
    });
    await emitEvent(tx, "mock.no_show", { bookingId: booking.id }, { userId: booking.userId });
  });
  return { ok: true };
}

/** Общий шаг отмены интервьюером/системой: бронь → cancelled_interviewer, слот
 *  закрывается, ученик уведомляется, его waitlist в начало очереди (spec 7.8). */
async function cancelByInterviewerTx(
  tx: Db,
  booking: Booking & { slot: { id: string; startsAt: Date; interviewerId: string } },
  now: Date,
): Promise<void> {
  await tx.booking.update({
    where: { id: booking.id },
    data: { status: "cancelled_interviewer", cancelledAt: now },
  });
  await tx.slot.update({ where: { id: booking.slotId }, data: { status: "closed" } });
  await emitEvent(
    tx,
    "mock.cancelled",
    { bookingId: booking.id, by: "interviewer", late: false },
    { userId: booking.userId },
  );
  await notify(tx, booking.userId, "mock_cancelled", { audience: "student" });
  await prioritizeWaitlistForVictim(tx, { userId: booking.userId, type: booking.type, now });
}

export type InterviewerCancelResult =
  { ok: true } | { ok: false; code: "not_found" | "not_cancellable" };

/** Отмена конкретной брони интервьюером (spec 7.8). */
export async function cancelBookingByInterviewer(
  db: PrismaClient,
  input: { interviewerId: string; bookingId: string; now?: Date },
): Promise<InterviewerCancelResult> {
  const now = input.now ?? new Date();
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: true },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) {
    return { ok: false, code: "not_found" };
  }
  if (booking.status !== "booked") return { ok: false, code: "not_cancellable" };
  await db.$transaction((tx) => cancelByInterviewerTx(tx, booking, now));
  return { ok: true };
}

/**
 * «Закрыть день» (spec 7.8): все открытые слоты дня → closed; забронированные —
 * брони отменяются (cancelled_interviewer), ученикам уведомление + waitlist в
 * начало очереди. Добавляет day_off-исключение, чтобы пересборка не переоткрыла день.
 */
export async function closeDay(
  db: PrismaClient,
  input: { interviewerId: string; date: string; now?: Date },
): Promise<{ closed: number; cancelled: number }> {
  const now = input.now ?? new Date();
  const interviewer = await db.user.findUnique({
    where: { id: input.interviewerId },
    select: { timezone: true, isInterviewer: true },
  });
  if (!interviewer || !interviewer.isInterviewer) return { closed: 0, cancelled: 0 };

  const { start, end } = zonedDayUtcRange(input.date, interviewer.timezone);
  const dayStart = start.getTime() > now.getTime() ? start : now;

  return db.$transaction(async (tx) => {
    // day_off-исключение (идемпотентно), чтобы slotsGenerate не переоткрыл день.
    const dateOnly = dateOnlyUtc(input.date);
    const hasDayOff = await tx.availabilityException.findFirst({
      where: { interviewerId: input.interviewerId, date: dateOnly, kind: "day_off" },
    });
    if (!hasDayOff) {
      await tx.availabilityException.create({
        data: { interviewerId: input.interviewerId, date: dateOnly, kind: "day_off" },
      });
    }

    const slots = await tx.slot.findMany({
      where: {
        interviewerId: input.interviewerId,
        startsAt: { gte: dayStart, lt: end },
      },
      // A slot can carry cancelled bookings too — take only the active one.
      include: { bookings: { where: { status: "booked" }, take: 1 } },
    });

    let closed = 0;
    let cancelled = 0;
    for (const slot of slots) {
      const active = slot.bookings[0];
      if (slot.status === "booked" && active && active.status === "booked") {
        await cancelByInterviewerTx(
          tx,
          {
            ...active,
            slot: { id: slot.id, startsAt: slot.startsAt, interviewerId: slot.interviewerId },
          },
          now,
        );
        cancelled += 1;
      } else if (slot.status === "open") {
        await tx.slot.update({ where: { id: slot.id }, data: { status: "closed" } });
        closed += 1;
      }
    }
    return { closed, cancelled };
  });
}

// --- Экран проведения (spec 7.8) ---

export type SaveNotesResult = { ok: true } | { ok: false; code: "not_found" };

export async function saveNotes(
  db: Db,
  input: { interviewerId: string; bookingId: string; text: string },
): Promise<SaveNotesResult> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: { select: { interviewerId: true } } },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) {
    return { ok: false, code: "not_found" };
  }
  await db.booking.update({
    where: { id: booking.id },
    data: { notesDraft: input.text.slice(0, 20000) },
  });
  return { ok: true };
}

export type SetMarkResult = { ok: true } | { ok: false; code: "not_found" };

/** Тумблер «ответил / частично / нет» → mock_question_marks (spec 7.8). null снимает. */
export async function setQuestionMark(
  db: Db,
  input: { interviewerId: string; bookingId: string; questionId: string; mark: MockMark | null },
): Promise<SetMarkResult> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: { select: { interviewerId: true } } },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) {
    return { ok: false, code: "not_found" };
  }
  if (input.mark === null) {
    await db.mockQuestionMark.deleteMany({
      where: { bookingId: input.bookingId, questionId: input.questionId },
    });
    return { ok: true };
  }
  await db.mockQuestionMark.upsert({
    where: { bookingId_questionId: { bookingId: input.bookingId, questionId: input.questionId } },
    create: { bookingId: input.bookingId, questionId: input.questionId, mark: input.mark },
    update: { mark: input.mark },
  });
  return { ok: true };
}

export type CompleteMockResult =
  { ok: true } | { ok: false; code: "not_found" | "not_completable" };

/** Регэксп мок-урока (spec 7.3): `:::mock{type=theory|legend}`. */
const MOCK_DIRECTIVE = /:::mock\{[^}]*type\s*=\s*"?(theory|legend)"?/;

/** Мок-уроки Soft Skills данного типа, ещё не завершённые учеником, — закрыть (spec 7.3). */
async function closeMockLessonsForType(
  db: PrismaClient,
  input: { userId: string; type: MockType; now: Date },
): Promise<void> {
  const lessons = await db.lesson.findMany({
    where: { status: "published", contentMd: { contains: ":::mock" } },
    select: { id: true, contentMd: true },
  });
  for (const lesson of lessons) {
    const match = MOCK_DIRECTIVE.exec(lesson.contentMd);
    if (!match || match[1] !== input.type) continue;
    const progress = await db.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: input.userId, lessonId: lesson.id } },
      select: { status: true },
    });
    if (progress?.status === "completed") continue;
    // completeLesson идемпотентен и сам решает гейтинг (Soft Skills — free).
    await completeLesson(db, { userId: input.userId, lessonId: lesson.id, now: input.now });
  }
}

/**
 * «Завершить мок» (spec 7.8): status=completed, эмит mock.completed (+200 XP
 * ученику, достижения), отметки partial|failed → SRS (source=mock), закрытие
 * мок-урока Soft Skills соответствующего типа. Идемпотентно по booking (эмит).
 */
export async function completeMock(
  db: PrismaClient,
  input: { interviewerId: string; bookingId: string; now?: Date },
): Promise<CompleteMockResult> {
  const now = input.now ?? new Date();
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: { slot: { select: { interviewerId: true } } },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) {
    return { ok: false, code: "not_found" };
  }
  if (booking.status !== "booked") return { ok: false, code: "not_completable" };

  await db.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: "completed" } });
    await emitEvent(
      tx,
      "mock.completed",
      { bookingId: booking.id, type: booking.type },
      { userId: booking.userId, now },
    );
    // Отметки partial|failed → SRS (spec 7.8): сброс/создание карточки, source=mock.
    const marks = await tx.mockQuestionMark.findMany({
      where: { bookingId: booking.id, mark: { in: ["partial", "failed"] } },
      select: { questionId: true },
    });
    for (const mark of marks) {
      await addSrsCardForFailure(tx, {
        userId: booking.userId,
        questionId: mark.questionId,
        source: "mock",
        now,
      });
    }
  });

  // Закрытие мок-урока — после коммита (completeLesson открывает свою транзакцию).
  await closeMockLessonsForType(db, { userId: booking.userId, type: booking.type, now });
  return { ok: true };
}

// --- Отмена броней при истечении доступа (spec 7.1.5) ---

/**
 * Отменяет будущие брони уже неактивных (expired/blocked) учеников (spec 7.1.5):
 * бронь → cancelled_student с system-пометкой в аудит, слот открывается и уходит в
 * waitlist, интервьюер уведомляется. Идемпотентно (ловит и лениво-истёкших, кого
 * не застал воркер-флип). Вызывается воркером expiryNotify/expire (этап 9).
 */
export async function cancelFutureBookingsForInactiveStudents(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const bookings = await db.booking.findMany({
    where: {
      status: "booked",
      slot: { startsAt: { gt: now } },
      user: { status: { in: ["expired", "blocked"] } },
    },
    include: { slot: true },
  });
  for (const booking of bookings) {
    await db.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: "cancelled_student", cancelledAt: now },
      });
      await tx.slot.update({ where: { id: booking.slotId }, data: { status: "open" } });
      await writeAudit(tx, {
        actorId: booking.userId,
        action: "system.booking.cancelled_expired",
        entityType: "booking",
        entityId: booking.id,
        before: { status: "booked" },
        after: { status: "cancelled_student", reason: "access_expired" },
      });
      await emitEvent(
        tx,
        "mock.cancelled",
        { bookingId: booking.id, by: "system", late: false },
        { userId: booking.userId },
      );
      await notify(tx, booking.slot.interviewerId, "mock_cancelled", {
        audience: "interviewer",
        by: "system",
      });
      await offerSlotToWaitlist(tx, { slotId: booking.slotId, now });
    });
  }
  return bookings.length;
}

// --- Запросы для страниц ---

export interface ActiveBookingCard {
  bookingId: string;
  type: MockType;
  startsAt: Date;
  endsAt: Date;
  interviewerName: string;
  roomUrl: string;
}

/** Активная бронь ученика (spec 8.3): booked и в будущем — карточка дашборда/моков. */
export async function getActiveBooking(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<ActiveBookingCard | null> {
  const booking = await db.booking.findFirst({
    where: { userId, status: "booked", slot: { startsAt: { gt: now } } },
    orderBy: { slot: { startsAt: "asc" } },
    include: { slot: { include: { interviewer: { select: { name: true } } } } },
  });
  if (!booking) return null;
  return {
    bookingId: booking.id,
    type: booking.type,
    startsAt: booking.slot.startsAt,
    endsAt: booking.slot.endsAt,
    interviewerName: booking.slot.interviewer.name,
    roomUrl: booking.roomUrl,
  };
}

export interface MockListItem {
  bookingId: string;
  type: MockType;
  status: Booking["status"];
  startsAt: Date;
  interviewerName: string;
  verdict: string | null;
  feedbackPublished: boolean;
}

async function toListItem(
  booking: Booking & {
    slot: { startsAt: Date; interviewer: { name: string } };
    feedback: { verdict: string; status: string } | null;
  },
): Promise<MockListItem> {
  return {
    bookingId: booking.id,
    type: booking.type,
    status: booking.status,
    startsAt: booking.slot.startsAt,
    interviewerName: booking.slot.interviewer.name,
    verdict: booking.feedback?.status === "published" ? booking.feedback.verdict : null,
    feedbackPublished: booking.feedback?.status === "published",
  };
}

/** /mocks/mine (spec 8.3): предстоящие + история со статусами и вердиктами. */
export async function getMyMocks(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<{ upcoming: MockListItem[]; history: MockListItem[] }> {
  const bookings = await db.booking.findMany({
    where: { userId },
    include: {
      slot: { include: { interviewer: { select: { name: true } } } },
      feedback: { select: { verdict: true, status: true } },
    },
    orderBy: { slot: { startsAt: "desc" } },
  });
  const upcoming: MockListItem[] = [];
  const history: MockListItem[] = [];
  for (const booking of bookings) {
    const item = await toListItem(booking);
    if (booking.status === "booked" && booking.slot.startsAt > now) upcoming.push(item);
    else history.push(item);
  }
  upcoming.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { upcoming, history };
}

/** Кол-во проведённых моков — итог /expired (spec 7.1.6) и карточка ученика. */
export async function getMocksCompletedCount(db: Db, userId: string): Promise<number> {
  return db.booking.count({ where: { userId, status: "completed" } });
}
