import { beforeEach, describe, expect, it } from "vitest";
import { cancelBooking, computeBookingLock, markNoShow } from "@/lib/services/mocks";
import { addDays, addMinutes } from "@/lib/utils/dates";
import { resetDb, testDb } from "./helpers/db";
import { createInterviewer, createStudent } from "./helpers/mocks";

// Обязательный набор этапа 6: страйки и лок (spec 7.8) — окно 60 дней, 2 → 14 дней;
// «Не пришёл» (окно +10 мин); late_cancel <24ч.

const NOW = new Date("2026-07-08T12:00:00.000Z");

describe("computeBookingLock — чистое ядро (spec 7.8)", () => {
  const strike = (daysAgo: number, reason: "late_cancel" | "no_show" = "no_show") => ({
    reason,
    createdAt: addDays(NOW, -daysAgo),
  });

  it("2 страйка за 60 дней → лок 14 дней от второго страйка", () => {
    const lock = computeBookingLock([strike(3), strike(1)], NOW);
    expect(lock).not.toBeNull();
    // Второй страйк — вчера; лок до вчера + 14 дней.
    expect(lock!.lockedUntil.getTime()).toBe(addDays(addDays(NOW, -1), 14).getTime());
    expect(lock!.recentStrikes).toHaveLength(2);
  });

  it("один страйк лок не даёт", () => {
    expect(computeBookingLock([strike(1)], NOW)).toBeNull();
  });

  it("страйки дальше 60 дней друг от друга лок не образуют", () => {
    expect(computeBookingLock([strike(100), strike(30)], NOW)).toBeNull();
  });

  it("истёкший лок (второй страйк 20 дней назад) не активен", () => {
    // Пара 25 и 20 дней назад: в пределах 60 дней, но 20 + 14 = 6 дней назад < now.
    expect(computeBookingLock([strike(25), strike(20)], NOW)).toBeNull();
  });

  it("третий страйк продлевает лок от последней пары", () => {
    const lock = computeBookingLock([strike(40), strike(10), strike(2)], NOW);
    expect(lock).not.toBeNull();
    expect(lock!.lockedUntil.getTime()).toBe(addDays(addDays(NOW, -2), 14).getTime());
  });
});

describe("отмена брони и страйки (spec 7.8)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function makeBooking(startsAt: Date) {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const booking = await testDb.booking.create({
      data: {
        slot: {
          create: {
            interviewerId: interviewer.id,
            startsAt,
            endsAt: addMinutes(startsAt, 60),
            status: "booked",
          },
        },
        user: { connect: { id: student.id } },
        type: "theory",
        status: "booked",
        roomUrl: "https://telemost.yandex.ru/room",
      },
      include: { slot: true },
    });
    return { interviewer, student, booking };
  }

  it("отмена ≥24ч — без страйка, слот открывается", async () => {
    const { student, booking } = await makeBooking(addDays(NOW, 3));
    const res = await cancelBooking(testDb, {
      userId: student.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.strikeIssued).toBe(false);
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: booking.slotId } })).status).toBe(
      "open",
    );
    expect(await testDb.bookingStrike.count({ where: { userId: student.id } })).toBe(0);
  });

  it("отмена <24ч — страйк late_cancel, слот открывается", async () => {
    const { student, booking } = await makeBooking(addMinutes(NOW, 60));
    const res = await cancelBooking(testDb, {
      userId: student.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.strikeIssued).toBe(true);
    const strikes = await testDb.bookingStrike.findMany({ where: { userId: student.id } });
    expect(strikes).toHaveLength(1);
    expect(strikes[0]!.reason).toBe("late_cancel");
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: booking.slotId } })).status).toBe(
      "open",
    );
  });
});

describe("«Не пришёл» — окно +10 мин (spec 7.8)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function makeBooking(startsAt: Date) {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const booking = await testDb.booking.create({
      data: {
        slot: {
          create: {
            interviewerId: interviewer.id,
            startsAt,
            endsAt: addMinutes(startsAt, 60),
            status: "booked",
          },
        },
        user: { connect: { id: student.id } },
        type: "theory",
        status: "booked",
        roomUrl: "https://telemost.yandex.ru/room",
      },
      include: { slot: true },
    });
    return { interviewer, student, booking };
  }

  it("до +10 мин отклоняется (too_early)", async () => {
    const { interviewer, booking } = await makeBooking(addMinutes(NOW, -5));
    const res = await markNoShow(testDb, {
      interviewerId: interviewer.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("too_early");
  });

  it("через +10 мин → no_show + страйк", async () => {
    const { interviewer, student, booking } = await makeBooking(addMinutes(NOW, -15));
    const res = await markNoShow(testDb, {
      interviewerId: interviewer.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect((await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "no_show",
    );
    const strikes = await testDb.bookingStrike.findMany({ where: { userId: student.id } });
    expect(strikes).toHaveLength(1);
    expect(strikes[0]!.reason).toBe("no_show");
  });

  it("чужой интервьюер отметить не может", async () => {
    const { booking } = await makeBooking(addMinutes(NOW, -15));
    const other = await createInterviewer("other@test.local");
    const res = await markNoShow(testDb, {
      interviewerId: other.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("not_found");
  });
});
