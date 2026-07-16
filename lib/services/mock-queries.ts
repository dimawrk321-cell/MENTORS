import type { Booking, MockMark, MockType } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  addDays,
  addMinutes,
  formatDayHeadingRu,
  formatTimeRu,
  localDateStr,
} from "@/lib/utils/dates";
import { NO_SHOW_AFTER_MINUTES, RUN_ACCESS_LEAD_MINUTES, SLOT_HORIZON_DAYS } from "@/lib/constants";
import { getBookingLock, getMocksCompletedCount, type BookingLock } from "@/lib/services/mocks";
import { getLaggingCategories, type LaggingCategory } from "@/lib/services/srs";
import { listCoursesForStudent } from "@/lib/services/content";

// Read-side страничные запросы моков (spec 8.3/8.4): доступные слоты для мастера
// бронирования, карточки интервьюеров, детали брони, список броней интервьюера,
// данные экрана проведения. Мутации — в mocks.ts, генерация слотов — в slots.ts.

// --- Мастер бронирования (spec 8.3) ---

export interface SlotChip {
  slotId: string;
  startsAt: Date;
  timeLabel: string;
  /** Для объединённого календаря «Первый свободный». */
  interviewerName: string;
}

export interface SlotDay {
  dateStr: string;
  heading: string;
  chips: SlotChip[];
}

export interface AvailableSlots {
  days: SlotDay[];
  timezone: string;
}

/**
 * Доступные для брони слоты (spec 7.8/8.3): open, в будущем, ≤ access_until,
 * профиль интервьюера активен, слот не держится чужим hold-предложением.
 * Сгруппированы по локальным дням ученика, чипы времени — в его TZ.
 */
export async function getAvailableSlots(
  db: Db,
  input: { studentId: string; type: MockType; interviewerId?: string | null; now?: Date },
): Promise<AvailableSlots> {
  const now = input.now ?? new Date();
  const student = await db.user.findUnique({
    where: { id: input.studentId },
    select: { timezone: true, accessUntil: true },
  });
  if (!student) return { days: [], timezone: "Europe/Moscow" };

  const horizonEnd = addDays(now, SLOT_HORIZON_DAYS + 1);
  const upper =
    student.accessUntil && student.accessUntil < horizonEnd ? student.accessUntil : horizonEnd;

  const heldForOther = await db.waitlist.findMany({
    where: { status: "offered", offerExpiresAt: { gt: now }, userId: { not: input.studentId } },
    select: { offeredSlotId: true },
  });
  const heldIds = heldForOther
    .map((h) => h.offeredSlotId)
    .filter((id): id is string => id !== null);

  const slots = await db.slot.findMany({
    where: {
      status: "open",
      startsAt: { gt: now, lte: upper },
      interviewer: { isInterviewer: true, interviewerProfile: { active: true } },
      ...(input.interviewerId ? { interviewerId: input.interviewerId } : {}),
      ...(heldIds.length > 0 ? { id: { notIn: heldIds } } : {}),
    },
    orderBy: { startsAt: "asc" },
    include: { interviewer: { select: { name: true } } },
  });

  const byDay = new Map<string, SlotChip[]>();
  for (const slot of slots) {
    const dateStr = localDateStr(slot.startsAt, student.timezone);
    const chips = byDay.get(dateStr) ?? [];
    chips.push({
      slotId: slot.id,
      startsAt: slot.startsAt,
      timeLabel: formatTimeRu(slot.startsAt, student.timezone),
      interviewerName: slot.interviewer.name,
    });
    byDay.set(dateStr, chips);
  }

  const days: SlotDay[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dateStr, chips]) => ({
      dateStr,
      heading: formatDayHeadingRu(chips[0]!.startsAt, student.timezone),
      chips,
    }));
  return { days, timezone: student.timezone };
}

export interface InterviewerCard {
  userId: string;
  name: string;
  bio: string | null;
  photo: string | null;
  avatarColor: number;
  /** Ближайший доступный слот — подсказка «есть окна». */
  hasSlots: boolean;
}

/** Карточки интервьюеров для шага 2 мастера (spec 8.3): активные профили. */
export async function listBookableInterviewers(
  db: Db,
  now: Date = new Date(),
): Promise<InterviewerCard[]> {
  const profiles = await db.interviewerProfile.findMany({
    where: { active: true, user: { isInterviewer: true } },
    include: { user: { select: { id: true, name: true, avatarColor: true } } },
    orderBy: { createdAt: "asc" },
  });
  const cards: InterviewerCard[] = [];
  for (const profile of profiles) {
    const openCount = await db.slot.count({
      where: { interviewerId: profile.userId, status: "open", startsAt: { gt: now } },
    });
    cards.push({
      userId: profile.userId,
      name: profile.user.name,
      bio: profile.bio,
      photo: profile.photo,
      avatarColor: profile.user.avatarColor,
      hasSlots: openCount > 0,
    });
  }
  return cards;
}

export interface MocksPageData {
  activeBooking: {
    bookingId: string;
    type: MockType;
    startsAt: Date;
    interviewerName: string;
    roomUrl: string;
  } | null;
  lock: BookingLock | null;
  offers: Array<{ waitlistId: string; type: MockType; startsAt: Date; interviewerName: string }>;
}

/** Данные /mocks (spec 8.3): активная бронь, плашка лока, активные hold-предложения. */
export async function getMocksPageData(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<MocksPageData> {
  const [booking, lock, offerEntries] = await Promise.all([
    db.booking.findFirst({
      where: { userId, status: "booked", slot: { startsAt: { gt: now } } },
      orderBy: { slot: { startsAt: "asc" } },
      include: { slot: { include: { interviewer: { select: { name: true } } } } },
    }),
    getBookingLock(db, userId, now),
    db.waitlist.findMany({
      where: { userId, status: "offered", offerExpiresAt: { gt: now } },
      include: {
        offeredSlot: { include: { interviewer: { select: { name: true } } } },
      },
    }),
  ]);

  return {
    activeBooking: booking
      ? {
          bookingId: booking.id,
          type: booking.type,
          startsAt: booking.slot.startsAt,
          interviewerName: booking.slot.interviewer.name,
          roomUrl: booking.roomUrl,
        }
      : null,
    lock,
    offers: offerEntries.flatMap((entry) =>
      entry.offeredSlot
        ? [
            {
              waitlistId: entry.id,
              type: entry.type,
              startsAt: entry.offeredSlot.startsAt,
              interviewerName: entry.offeredSlot.interviewer.name,
            },
          ]
        : [],
    ),
  };
}

export interface BookingDetail {
  booking: {
    id: string;
    type: MockType;
    status: Booking["status"];
    startsAt: Date;
    endsAt: Date;
    roomUrl: string;
    interviewerName: string;
  };
  feedbackStatus: "none" | "draft" | "published";
}

/** Карточка брони ученика (spec 8.3): детали + статус фидбека. */
export async function getBookingDetail(
  db: Db,
  input: { userId: string; bookingId: string },
): Promise<BookingDetail | null> {
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      slot: { include: { interviewer: { select: { name: true } } } },
      feedback: { select: { status: true } },
    },
  });
  if (!booking || booking.userId !== input.userId) return null;
  return {
    booking: {
      id: booking.id,
      type: booking.type,
      status: booking.status,
      startsAt: booking.slot.startsAt,
      endsAt: booking.slot.endsAt,
      roomUrl: booking.roomUrl,
      interviewerName: booking.slot.interviewer.name,
    },
    feedbackStatus: booking.feedback
      ? booking.feedback.status === "published"
        ? "published"
        : "draft"
      : "none",
  };
}

// --- Кабинет интервьюера (spec 8.4) ---

export interface InterviewerBookingRow {
  bookingId: string;
  type: MockType;
  status: Booking["status"];
  startsAt: Date;
  endsAt: Date;
  studentId: string;
  studentName: string;
  roomUrl: string;
  /** Экран проведения доступен с −15 мин (spec 8.4). */
  canRun: boolean;
}

export interface InterviewerBookingsData {
  today: InterviewerBookingRow[];
  week: InterviewerBookingRow[];
}

/** /interviewer/bookings (spec 8.4): сегодня и неделя. */
export async function getInterviewerBookings(
  db: Db,
  input: { interviewerId: string; timezone: string; now?: Date },
): Promise<InterviewerBookingsData> {
  const now = input.now ?? new Date();
  const weekEnd = addDays(now, 7);
  const bookings = await db.booking.findMany({
    where: {
      slot: {
        interviewerId: input.interviewerId,
        startsAt: { gte: addMinutes(now, -60), lt: weekEnd },
      },
      status: "booked",
    },
    include: {
      slot: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { slot: { startsAt: "asc" } },
  });

  const todayStr = localDateStr(now, input.timezone);
  const today: InterviewerBookingRow[] = [];
  const week: InterviewerBookingRow[] = [];
  for (const booking of bookings) {
    const row: InterviewerBookingRow = {
      bookingId: booking.id,
      type: booking.type,
      status: booking.status,
      startsAt: booking.slot.startsAt,
      endsAt: booking.slot.endsAt,
      studentId: booking.user.id,
      studentName: booking.user.name,
      roomUrl: booking.roomUrl,
      canRun: now >= addMinutes(booking.slot.startsAt, -RUN_ACCESS_LEAD_MINUTES),
    };
    if (localDateStr(booking.slot.startsAt, input.timezone) === todayStr) today.push(row);
    else week.push(row);
  }
  return { today, week };
}

// --- Экран проведения (spec 7.8/8.4) ---

export interface RunStudentCard {
  studentId: string;
  studentName: string;
  courses: Array<{ title: string; progressPct: number }>;
  pastMocks: Array<{ type: MockType; verdict: string | null; startsAt: Date }>;
  lagging: LaggingCategory[] | null;
  mocksCompleted: number;
}

export interface RunQuestion {
  id: string;
  textMd: string;
  answerMd: string | null;
  categoryId: string;
  categoryTitle: string;
  colorIndex: number;
  mark: MockMark | null;
}

export interface RunScreenData {
  booking: {
    id: string;
    type: MockType;
    status: Booking["status"];
    startsAt: Date;
    endsAt: Date;
    roomUrl: string;
    notesDraft: string;
  };
  student: RunStudentCard;
  categories: Array<{ id: string; title: string; colorIndex: number }>;
  questions: RunQuestion[];
  /** −15 мин: экран доступен; +10 мин: «Не пришёл» активна (spec 7.8). */
  canRun: boolean;
  canNoShow: boolean;
  canComplete: boolean;
}

/** Данные экрана проведения (spec 7.8): бронь, карточка ученика, банк вопросов, отметки. */
export async function getRunScreenData(
  db: Db,
  input: { interviewerId: string; bookingId: string; now?: Date },
): Promise<RunScreenData | null> {
  const now = input.now ?? new Date();
  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      slot: true,
      user: { select: { id: true, name: true, track: true } },
    },
  });
  if (!booking || booking.slot.interviewerId !== input.interviewerId) return null;

  const [courses, pastMocks, lagging, mocksCompleted, marks, categories, questions] =
    await Promise.all([
      listCoursesForStudent(db, booking.userId, booking.user.track),
      db.booking.findMany({
        where: { userId: booking.userId, status: "completed", id: { not: booking.id } },
        include: {
          slot: { select: { startsAt: true } },
          feedback: { select: { verdict: true, status: true } },
        },
        orderBy: { slot: { startsAt: "desc" } },
        take: 5,
      }),
      getLaggingCategories(db, { userId: booking.userId, now }),
      getMocksCompletedCount(db, booking.userId),
      db.mockQuestionMark.findMany({ where: { bookingId: booking.id } }),
      db.questionCategory.findMany({
        where: { parentId: null },
        orderBy: { order: "asc" },
        select: { id: true, title: true, colorIndex: true },
      }),
      db.question.findMany({
        where: { status: "published", type: "open" },
        include: {
          category: {
            select: {
              id: true,
              title: true,
              colorIndex: true,
              parentId: true,
              parent: { select: { id: true, title: true, colorIndex: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  const markByQuestion = new Map(marks.map((m) => [m.questionId, m.mark]));

  return {
    booking: {
      id: booking.id,
      type: booking.type,
      status: booking.status,
      startsAt: booking.slot.startsAt,
      endsAt: booking.slot.endsAt,
      roomUrl: booking.roomUrl,
      notesDraft: booking.notesDraft ?? "",
    },
    student: {
      studentId: booking.user.id,
      studentName: booking.user.name,
      courses: courses.map((c) => ({ title: c.title, progressPct: c.progressPct })),
      pastMocks: pastMocks.map((m) => ({
        type: m.type,
        verdict: m.feedback?.status === "published" ? m.feedback.verdict : null,
        startsAt: m.slot.startsAt,
      })),
      lagging,
      mocksCompleted,
    },
    categories,
    questions: questions.map((q) => {
      const root = q.category.parent ?? q.category;
      return {
        id: q.id,
        textMd: q.textMd,
        answerMd: q.answerMd,
        categoryId: root.id,
        categoryTitle: root.title,
        colorIndex: root.colorIndex,
        mark: markByQuestion.get(q.id) ?? null,
      };
    }),
    canRun: now >= addMinutes(booking.slot.startsAt, -RUN_ACCESS_LEAD_MINUTES),
    canNoShow:
      booking.status === "booked" &&
      now >= addMinutes(booking.slot.startsAt, NO_SHOW_AFTER_MINUTES),
    canComplete: booking.status === "booked",
  };
}
