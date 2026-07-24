import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { cancelBooking, transferBooking } from "@/lib/services/mocks";
import { addDays, addMinutes } from "@/lib/utils/dates";
import { resetDb, testDb } from "./helpers/db";
import { createInterviewer, createSlot, createStudent } from "./helpers/mocks";

// Walk 13.4 block 3: атомарный перенос брони (spec 7.8). Обязательная матрица —
// атомарность, страйк <24ч / его отсутствие ≥24ч, waitlist получает старый слот,
// гонка двух параллельных переносов, перенос при booking-lock отклонён.

const NOW = new Date("2026-07-08T12:00:00.000Z");

async function makeBooking(opts: {
  interviewerId: string;
  studentId: string;
  startsAt: Date;
  type?: "theory" | "legend";
}) {
  return testDb.booking.create({
    data: {
      slot: {
        create: {
          interviewerId: opts.interviewerId,
          startsAt: opts.startsAt,
          endsAt: addMinutes(opts.startsAt, 60),
          status: "booked",
        },
      },
      user: { connect: { id: opts.studentId } },
      type: opts.type ?? "theory",
      status: "booked",
      roomUrl: "https://telemost.yandex.ru/old",
    },
    include: { slot: true },
  });
}

/** testDb-прокси, у которого booking.create внутри транзакции падает — для проверки
 *  атомарности (сбой на создании новой брони → старая нетронута). */
function dbFailingOnBookingCreate(): PrismaClient {
  const wrapTx = (tx: object) =>
    new Proxy(tx, {
      get(target, prop) {
        if (prop === "booking") {
          const delegate = Reflect.get(target, prop) as object;
          return new Proxy(delegate, {
            get(bTarget, bProp) {
              if (bProp === "create") {
                return () => Promise.reject(new Error("injected failure: booking.create"));
              }
              const v = Reflect.get(bTarget, bProp);
              return typeof v === "function" ? v.bind(bTarget) : v;
            },
          });
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });

  return new Proxy(testDb, {
    get(target, prop) {
      if (prop === "$transaction") {
        return (arg: unknown, opts?: unknown) => {
          const fn = arg as (tx: unknown) => Promise<unknown>;
          const run = target.$transaction as (
            f: (t: unknown) => Promise<unknown>,
            o?: unknown,
          ) => Promise<unknown>;
          return run((tx: unknown) => fn(wrapTx(tx as object)), opts);
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as unknown as PrismaClient;
}

describe("transferBooking — атомарный перенос (spec 7.8 / changelog 13.4 block 3)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("перенос ≥24ч: старая отменена, новая создана, room_url скопирован, без страйка", async () => {
    const interviewer = await createInterviewer("i@test.local", "Europe/Moscow", {
      roomUrl: "https://telemost.yandex.ru/room-A",
    });
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: student.id,
      startsAt: addDays(NOW, 3),
    });
    const newSlot = await createSlot(interviewer.id, addDays(NOW, 5));

    const res = await transferBooking(testDb, {
      userId: student.id,
      bookingId: oldBooking.id,
      newSlotId: newSlot.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.strikeIssued).toBe(false);
    if (!res.ok) throw new Error("unreachable");

    const old = await testDb.booking.findUniqueOrThrow({ where: { id: oldBooking.id } });
    expect(old.status).toBe("cancelled_student");
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: oldBooking.slotId } })).status).toBe(
      "open",
    );

    const created = await testDb.booking.findUniqueOrThrow({ where: { id: res.newBookingId } });
    expect(created.status).toBe("booked");
    expect(created.roomUrl).toBe("https://telemost.yandex.ru/room-A");
    expect(created.type).toBe("theory");
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: newSlot.id } })).status).toBe(
      "booked",
    );

    expect(await testDb.bookingStrike.count({ where: { userId: student.id } })).toBe(0);
    // Инвариант «одна активная бронь».
    expect(await testDb.booking.count({ where: { userId: student.id, status: "booked" } })).toBe(1);

    // Тот же интервьюер → одно уведомление «перенос» ему; ученику — mock_moved.
    const interviewerNotifs = await testDb.notification.findMany({
      where: { userId: interviewer.id },
    });
    expect(interviewerNotifs.map((n) => n.type)).toEqual(["mock_moved"]);
    const studentNotifs = await testDb.notification.findMany({ where: { userId: student.id } });
    expect(studentNotifs.map((n) => n.type)).toEqual(["mock_moved"]);
  });

  it("перенос <24ч: страйк late_cancel", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: student.id,
      startsAt: addMinutes(NOW, 60), // <24ч
    });
    const newSlot = await createSlot(interviewer.id, addDays(NOW, 5));

    const res = await transferBooking(testDb, {
      userId: student.id,
      bookingId: oldBooking.id,
      newSlotId: newSlot.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.strikeIssued).toBe(true);
    const strikes = await testDb.bookingStrike.findMany({ where: { userId: student.id } });
    expect(strikes).toHaveLength(1);
    expect(strikes[0]!.reason).toBe("late_cancel");
    // Новая бронь всё равно создана.
    expect(await testDb.booking.count({ where: { userId: student.id, status: "booked" } })).toBe(1);
  });

  it("освободившийся старый слот уходит в waitlist подходящему ученику", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const mover = await createStudent("mover@test.local");
    const waiter = await createStudent("waiter@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: mover.id,
      startsAt: addDays(NOW, 3),
    });
    const newSlot = await createSlot(interviewer.id, addDays(NOW, 5));
    await testDb.waitlist.create({
      data: {
        userId: waiter.id,
        type: "theory",
        interviewerId: null,
        untilDate: addDays(NOW, 14),
        status: "waiting",
      },
    });

    const res = await transferBooking(testDb, {
      userId: mover.id,
      bookingId: oldBooking.id,
      newSlotId: newSlot.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);

    const wl = await testDb.waitlist.findFirstOrThrow({ where: { userId: waiter.id } });
    expect(wl.status).toBe("offered");
    expect(wl.offeredSlotId).toBe(oldBooking.slotId);
  });

  it("гонка двух параллельных переносов: одна выигрывает, состояние согласовано", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: student.id,
      startsAt: addDays(NOW, 3),
    });
    const slotA = await createSlot(interviewer.id, addDays(NOW, 5));
    const slotB = await createSlot(interviewer.id, addDays(NOW, 6));

    const [r1, r2] = await Promise.all([
      transferBooking(testDb, {
        userId: student.id,
        bookingId: oldBooking.id,
        newSlotId: slotA.id,
        now: NOW,
      }),
      transferBooking(testDb, {
        userId: student.id,
        bookingId: oldBooking.id,
        newSlotId: slotB.id,
        now: NOW,
      }),
    ]);

    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    // Ровно одна активная бронь; ровно один новый слот забронирован.
    expect(await testDb.booking.count({ where: { userId: student.id, status: "booked" } })).toBe(1);
    expect(
      await testDb.slot.count({ where: { id: { in: [slotA.id, slotB.id] }, status: "booked" } }),
    ).toBe(1);
    // Старая бронь отменена ровно один раз (без двойного страйка).
    expect(
      await testDb.booking.count({ where: { id: oldBooking.id, status: "cancelled_student" } }),
    ).toBe(1);
    expect(await testDb.bookingStrike.count({ where: { userId: student.id } })).toBe(0);
  });

  it("активный booking-lock отклоняет перенос; старая бронь нетронута", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: student.id,
      startsAt: addDays(NOW, 3),
    });
    const newSlot = await createSlot(interviewer.id, addDays(NOW, 5));
    // Два страйка за 60 дней → активный лок (spec 7.8).
    await testDb.bookingStrike.createMany({
      data: [
        {
          userId: student.id,
          bookingId: oldBooking.id,
          reason: "no_show",
          createdAt: addDays(NOW, -3),
        },
        {
          userId: student.id,
          bookingId: oldBooking.id,
          reason: "no_show",
          createdAt: addDays(NOW, -1),
        },
      ],
    });

    const res = await transferBooking(testDb, {
      userId: student.id,
      bookingId: oldBooking.id,
      newSlotId: newSlot.id,
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("locked");
    // Старая бронь и новый слот нетронуты.
    expect((await testDb.booking.findUniqueOrThrow({ where: { id: oldBooking.id } })).status).toBe(
      "booked",
    );
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: newSlot.id } })).status).toBe(
      "open",
    );
  });

  it("атомарность: сбой на создании новой брони → старая бронь полностью нетронута", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: student.id,
      startsAt: addDays(NOW, 3),
    });
    const newSlot = await createSlot(interviewer.id, addDays(NOW, 5));

    await expect(
      transferBooking(dbFailingOnBookingCreate(), {
        userId: student.id,
        bookingId: oldBooking.id,
        newSlotId: newSlot.id,
        now: NOW,
      }),
    ).rejects.toThrow();

    // Полный откат: старая бронь и её слот на месте, новый слот открыт, нет страйка,
    // новой брони нет.
    expect((await testDb.booking.findUniqueOrThrow({ where: { id: oldBooking.id } })).status).toBe(
      "booked",
    );
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: oldBooking.slotId } })).status).toBe(
      "booked",
    );
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: newSlot.id } })).status).toBe(
      "open",
    );
    expect(await testDb.bookingStrike.count({ where: { userId: student.id } })).toBe(0);
    expect(await testDb.booking.count({ where: { userId: student.id } })).toBe(1);
  });

  it("разные интервьюеры: старому — mock_cancelled, новому — mock_booked, ученику — mock_moved", async () => {
    const oldInt = await createInterviewer("old@test.local", "Europe/Moscow", {
      roomUrl: "https://telemost.yandex.ru/old-room",
    });
    const newInt = await createInterviewer("new@test.local", "Europe/Moscow", {
      roomUrl: "https://telemost.yandex.ru/new-room",
    });
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: oldInt.id,
      studentId: student.id,
      startsAt: addDays(NOW, 3),
    });
    const newSlot = await createSlot(newInt.id, addDays(NOW, 5));

    const res = await transferBooking(testDb, {
      userId: student.id,
      bookingId: oldBooking.id,
      newSlotId: newSlot.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");

    // room_url скопирован от НОВОГО интервьюера.
    const created = await testDb.booking.findUniqueOrThrow({ where: { id: res.newBookingId } });
    expect(created.roomUrl).toBe("https://telemost.yandex.ru/new-room");

    expect(
      (await testDb.notification.findMany({ where: { userId: oldInt.id } })).map((n) => n.type),
    ).toEqual(["mock_cancelled"]);
    expect(
      (await testDb.notification.findMany({ where: { userId: newInt.id } })).map((n) => n.type),
    ).toEqual(["mock_booked"]);
    expect(
      (await testDb.notification.findMany({ where: { userId: student.id } })).map((n) => n.type),
    ).toEqual(["mock_moved"]);
  });

  it("перенос и отмена одной брони параллельно: без дедлока, состояние согласовано", async () => {
    // Регрессия на lock-order: перенос лочит бронь РАНЬШЕ слотов (как cancelBooking),
    // иначе перенос(держит слот, ждёт бронь) × отмена(держит бронь, ждёт слот) = дедлок.
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: student.id,
      startsAt: addDays(NOW, 3),
    });
    const newSlot = await createSlot(interviewer.id, addDays(NOW, 5));

    const [transferRes, cancelRes] = await Promise.all([
      transferBooking(testDb, {
        userId: student.id,
        bookingId: oldBooking.id,
        newSlotId: newSlot.id,
        now: NOW,
      }),
      cancelBooking(testDb, { userId: student.id, bookingId: oldBooking.id, now: NOW }),
    ]);

    // Ровно одна операция применилась к старой брони — без дедлок-краша (P2034).
    expect([transferRes.ok, cancelRes.ok].filter(Boolean)).toHaveLength(1);
    expect((await testDb.booking.findUniqueOrThrow({ where: { id: oldBooking.id } })).status).toBe(
      "cancelled_student",
    );
    const active = await testDb.booking.count({
      where: { userId: student.id, status: "booked" },
    });
    const newSlotStatus = (await testDb.slot.findUniqueOrThrow({ where: { id: newSlot.id } }))
      .status;
    if (transferRes.ok) {
      expect(active).toBe(1); // новая бронь на newSlot
      expect(newSlotStatus).toBe("booked");
    } else {
      expect(active).toBe(0); // выиграла отмена — новой брони нет
      expect(newSlotStatus).toBe("open");
    }
  });

  it("перенос на тот же слот отклоняется (same_slot)", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const oldBooking = await makeBooking({
      interviewerId: interviewer.id,
      studentId: student.id,
      startsAt: addDays(NOW, 3),
    });

    const res = await transferBooking(testDb, {
      userId: student.id,
      bookingId: oldBooking.id,
      newSlotId: oldBooking.slotId,
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("same_slot");
    expect((await testDb.booking.findUniqueOrThrow({ where: { id: oldBooking.id } })).status).toBe(
      "booked",
    );
  });
});
