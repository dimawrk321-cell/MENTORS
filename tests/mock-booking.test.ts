import { beforeEach, describe, expect, it } from "vitest";
import { bookMock, cancelBooking } from "@/lib/services/mocks";
import { addDays, addMinutes } from "@/lib/utils/dates";
import { resetDb, testDb } from "./helpers/db";
import { createInterviewer, createSlot, createStudent } from "./helpers/mocks";

// Обязательный набор этапа 6: бронирование (spec 7.8) — гонка на один слот → одна
// бронь; правила access_until, «одна активная бронь», booking-lock.

const NOW = new Date("2026-07-08T12:00:00.000Z");
const SOON = addMinutes(NOW, 90); // будущий слот

beforeEach(async () => {
  await resetDb();
});

describe("успешная бронь (spec 7.8)", () => {
  it("бронирует open-слот, копирует room_url, помечает слот booked, эмитит mock.booked", async () => {
    const interviewer = await createInterviewer("i@test.local", "Europe/Moscow", {
      roomUrl: "https://telemost.yandex.ru/abc",
    });
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, SOON);

    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res.ok).toBe(true);

    const booking = await testDb.booking.findFirstOrThrow({ where: { userId: student.id } });
    expect(booking).toMatchObject({
      status: "booked",
      type: "theory",
      roomUrl: "https://telemost.yandex.ru/abc",
    });
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("booked");
    expect(
      await testDb.analyticsEvent.count({ where: { type: "mock.booked", userId: student.id } }),
    ).toBe(1);
  });
});

describe("гонка на один слот (spec 7.8: SELECT FOR UPDATE)", () => {
  it("две параллельные брони одного слота → ровно одна успешна", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const a = await createStudent("a@test.local");
    const b = await createStudent("b@test.local");
    const slot = await createSlot(interviewer.id, SOON);

    const [ra, rb] = await Promise.all([
      bookMock(testDb, { userId: a.id, slotId: slot.id, type: "theory", now: NOW }),
      bookMock(testDb, { userId: b.id, slotId: slot.id, type: "legend", now: NOW }),
    ]);

    const okCount = [ra, rb].filter((r) => r.ok).length;
    expect(okCount).toBe(1);
    expect(await testDb.booking.count({ where: { slotId: slot.id } })).toBe(1);
    const loser = [ra, rb].find((r) => !r.ok);
    expect(loser && !loser.ok && loser.code).toBe("slot_taken");
  });

  it("одна активная бронь под гонкой: параллельные брони РАЗНЫХ слотов одним учеником → одна успешна", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const slot1 = await createSlot(interviewer.id, SOON);
    const slot2 = await createSlot(interviewer.id, addMinutes(NOW, 200));

    // Без блокировки строки user обе транзакции лочат разные слоты и видят active=0.
    const [r1, r2] = await Promise.all([
      bookMock(testDb, { userId: student.id, slotId: slot1.id, type: "theory", now: NOW }),
      bookMock(testDb, { userId: student.id, slotId: slot2.id, type: "theory", now: NOW }),
    ]);
    expect([r1, r2].filter((r) => r.ok).length).toBe(1);
    expect(await testDb.booking.count({ where: { userId: student.id, status: "booked" } })).toBe(1);
  });
});

describe("правила бронирования (spec 7.8)", () => {
  it("нельзя бронировать слот со стартом позже access_until", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local", { accessUntil: addDays(NOW, 1) });
    const slot = await createSlot(interviewer.id, addDays(NOW, 5));

    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("beyond_access");
  });

  it("одна активная бронь: вторая бронь при живой первой отклоняется", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const slot1 = await createSlot(interviewer.id, SOON);
    const slot2 = await createSlot(interviewer.id, addMinutes(NOW, 200));

    expect(
      (await bookMock(testDb, { userId: student.id, slotId: slot1.id, type: "theory", now: NOW }))
        .ok,
    ).toBe(true);
    const second = await bookMock(testDb, {
      userId: student.id,
      slotId: slot2.id,
      type: "theory",
      now: NOW,
    });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.code).toBe("already_booked");
  });

  it("прошедший слот бронировать нельзя", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, addMinutes(NOW, -30));
    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("past");
  });

  it("booking-lock (2 страйка за 60 дней) блокирует бронирование", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    // Два страйка за последние дни → лок активен.
    const b1 = await testDb.booking.create({
      data: {
        slot: {
          create: {
            interviewerId: interviewer.id,
            startsAt: addDays(NOW, -3),
            endsAt: addDays(NOW, -3),
          },
        },
        user: { connect: { id: student.id } },
        type: "theory",
        status: "no_show",
        roomUrl: "x",
      },
    });
    await testDb.bookingStrike.createMany({
      data: [
        { userId: student.id, bookingId: b1.id, reason: "no_show", createdAt: addDays(NOW, -3) },
        {
          userId: student.id,
          bookingId: b1.id,
          reason: "late_cancel",
          createdAt: addDays(NOW, -1),
        },
      ],
    });

    const slot = await createSlot(interviewer.id, SOON);
    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("locked");
  });

  it("слот без активного профиля интервьюера бронировать нельзя", async () => {
    const interviewer = await createInterviewer("i@test.local", "Europe/Moscow", { active: false });
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, SOON);
    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("no_room");
  });
});

// Stage 12.2 (adversarial finding): a cancelled slot re-opens (spec 7.8) and MUST
// be re-bookable. With Booking.slot_id UNIQUE this threw P2002 on every re-book and
// permanently bricked the slot + burned every waitlist offer. slot_id is now a plain
// index; the "≤1 active booking per slot" invariant stays in bookMock's FOR UPDATE.
describe("повторная бронь освобождённого слота (spec 7.8 / stage 12.2)", () => {
  it("free-отмена переоткрывает слот; другой ученик бронирует его заново (без P2002)", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const a = await createStudent("a@test.local");
    const b = await createStudent("b@test.local");
    const slot = await createSlot(interviewer.id, addDays(NOW, 3)); // >24ч → free cancel

    const first = await bookMock(testDb, {
      userId: a.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(first.ok).toBe(true);
    const cancel = await cancelBooking(testDb, {
      userId: a.id,
      bookingId: first.ok ? first.bookingId : "",
      now: NOW,
    });
    expect(cancel.ok).toBe(true);
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("open");

    // Re-book the SAME slot — previously P2002 → uncaught → slot bricked forever.
    const second = await bookMock(testDb, {
      userId: b.id,
      slotId: slot.id,
      type: "legend",
      now: NOW,
    });
    expect(second.ok).toBe(true);
    expect((await testDb.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("booked");

    const all = await testDb.booking.findMany({ where: { slotId: slot.id } });
    expect(all.length).toBe(2); // history kept: 1 cancelled + 1 active
    const active = all.filter((x) => x.status === "booked");
    expect(active.length).toBe(1); // exactly one active per slot
    expect(active[0]!.userId).toBe(b.id);
  });

  it("late-отмена сохраняет страйк и всё равно допускает повторную бронь слота", async () => {
    const interviewer = await createInterviewer("i2@test.local");
    const a = await createStudent("a2@test.local");
    const b = await createStudent("b2@test.local");
    const slot = await createSlot(interviewer.id, SOON); // <24ч → late cancel + страйк

    const first = await bookMock(testDb, {
      userId: a.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(first.ok).toBe(true);
    const firstId = first.ok ? first.bookingId : "";
    const cancel = await cancelBooking(testDb, { userId: a.id, bookingId: firstId, now: NOW });
    expect(cancel.ok && cancel.late).toBe(true);
    // The strike lives on the retained cancelled booking row.
    expect(await testDb.bookingStrike.count({ where: { bookingId: firstId } })).toBe(1);

    const second = await bookMock(testDb, {
      userId: b.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(second.ok).toBe(true);
  });
});
