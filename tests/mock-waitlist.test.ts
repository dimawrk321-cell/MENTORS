import { beforeEach, describe, expect, it } from "vitest";
import {
  claimOffer,
  closeDay,
  offerSlotToWaitlist,
  processWaitlistHolds,
} from "@/lib/services/mocks";
import { addDays, addMinutes, dateOnlyUtc, zonedDateTimeToUtc } from "@/lib/utils/dates";
import { OFFER_HOLD_HOURS } from "@/lib/constants";
import { resetDb, testDb } from "./helpers/db";
import { createInterviewer, createSlot, createStudent } from "./helpers/mocks";

// Обязательный набор этапа 6: waitlist (spec 7.8) — очерёдность, hold 2 часа,
// истечение → следующий, приоритет пострадавших от «Закрыть день».

const NOW = new Date("2026-07-08T12:00:00.000Z");
const MSK = "Europe/Moscow";

beforeEach(async () => {
  await resetDb();
});

async function waiting(userId: string, createdAt: Date, type: "theory" | "legend" = "theory") {
  return testDb.waitlist.create({
    data: {
      userId,
      type,
      interviewerId: null,
      untilDate: addDays(dateOnlyUtc("2026-07-08"), 14),
      status: "waiting",
      createdAt,
    },
  });
}

describe("очерёдность и hold-предложение (spec 7.8)", () => {
  it("освободившийся слот предлагается первой по времени заявке; hold — 2 часа", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const a = await createStudent("a@test.local");
    const b = await createStudent("b@test.local");
    await waiting(a.id, addMinutes(NOW, -20)); // раньше
    await waiting(b.id, addMinutes(NOW, -5)); // позже
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));

    const res = await offerSlotToWaitlist(testDb, { slotId: slot.id, now: NOW });
    expect(res.offered).toBe(true);

    const offered = await testDb.waitlist.findFirstOrThrow({ where: { status: "offered" } });
    expect(offered.userId).toBe(a.id);
    expect(offered.offeredSlotId).toBe(slot.id);
    expect(offered.offerExpiresAt!.getTime()).toBe(NOW.getTime() + OFFER_HOLD_HOURS * 3600_000);
    // B остаётся ждать.
    expect((await testDb.waitlist.findFirstOrThrow({ where: { userId: b.id } })).status).toBe(
      "waiting",
    );
  });

  it("занятый hold не переназначается другому кандидату", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const a = await createStudent("a@test.local");
    const b = await createStudent("b@test.local");
    await waiting(a.id, addMinutes(NOW, -20));
    await waiting(b.id, addMinutes(NOW, -5));
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));

    await offerSlotToWaitlist(testDb, { slotId: slot.id, now: NOW });
    const again = await offerSlotToWaitlist(testDb, { slotId: slot.id, now: NOW });
    expect(again.offered).toBe(false);
    expect(await testDb.waitlist.count({ where: { status: "offered" } })).toBe(1);
  });
});

describe("истечение hold → следующий (spec 7.8)", () => {
  it("processWaitlistHolds возвращает истёкшую заявку в waiting и предлагает слот следующему", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const a = await createStudent("a@test.local");
    const b = await createStudent("b@test.local");
    const entryA = await waiting(a.id, addMinutes(NOW, -20));
    await waiting(b.id, addMinutes(NOW, -5));
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));

    await offerSlotToWaitlist(testDb, { slotId: slot.id, now: NOW });
    // Симулируем истёкший hold.
    await testDb.waitlist.update({
      where: { id: entryA.id },
      data: { offerExpiresAt: addMinutes(NOW, -1) },
    });

    const res = await processWaitlistHolds(testDb, NOW);
    expect(res.lapsed).toBe(1);

    const refreshedA = await testDb.waitlist.findUniqueOrThrow({ where: { id: entryA.id } });
    expect(refreshedA.status).toBe("waiting");
    const offered = await testDb.waitlist.findFirstOrThrow({ where: { status: "offered" } });
    expect(offered.userId).toBe(b.id); // ушло следующему, не обратно A
  });

  it("заявки, просроченные по until_date, помечаются expired", async () => {
    const student = await createStudent("s@test.local");
    await testDb.waitlist.create({
      data: {
        userId: student.id,
        type: "theory",
        untilDate: dateOnlyUtc("2026-07-01"),
        status: "waiting",
      },
    });
    const res = await processWaitlistHolds(testDb, NOW);
    expect(res.expired).toBe(1);
    expect((await testDb.waitlist.findFirstOrThrow({ where: { userId: student.id } })).status).toBe(
      "expired",
    );
  });
});

describe("клейм предложения (spec 7.8)", () => {
  it("claimOffer бронирует предложенный слот и помечает заявку converted", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));
    const entry = await testDb.waitlist.create({
      data: {
        userId: student.id,
        type: "theory",
        untilDate: addDays(dateOnlyUtc("2026-07-08"), 14),
        status: "offered",
        offeredSlotId: slot.id,
        offerExpiresAt: addMinutes(NOW, 60),
      },
    });

    const res = await claimOffer(testDb, { userId: student.id, waitlistId: entry.id, now: NOW });
    expect(res.ok).toBe(true);
    expect(await testDb.booking.count({ where: { userId: student.id, slotId: slot.id } })).toBe(1);
    expect((await testDb.waitlist.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe(
      "converted",
    );
  });

  it("истёкшее предложение клеймить нельзя", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));
    const entry = await testDb.waitlist.create({
      data: {
        userId: student.id,
        type: "theory",
        untilDate: addDays(dateOnlyUtc("2026-07-08"), 14),
        status: "offered",
        offeredSlotId: slot.id,
        offerExpiresAt: addMinutes(NOW, -1),
      },
    });
    const res = await claimOffer(testDb, { userId: student.id, waitlistId: entry.id, now: NOW });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.code).toBe("expired");
  });
});

describe("«Закрыть день» → приоритет пострадавших (spec 7.8)", () => {
  it("отменяет брони, ставит waitlist пострадавшего в начало очереди перед обычными", async () => {
    const interviewer = await createInterviewer("i@test.local", MSK);
    const victim = await createStudent("victim@test.local");
    const other = await createStudent("other@test.local");

    // Бронь пострадавшего на 2026-07-10 18:00 МСК.
    const start = zonedDateTimeToUtc("2026-07-10", "18:00", MSK);
    const booking = await testDb.booking.create({
      data: {
        slot: {
          create: {
            interviewerId: interviewer.id,
            startsAt: start,
            endsAt: addMinutes(start, 60),
            status: "booked",
          },
        },
        user: { connect: { id: victim.id } },
        type: "theory",
        status: "booked",
        roomUrl: "https://telemost.yandex.ru/room",
      },
    });
    // Обычная заявка другого ученика (создана «сейчас»).
    await waiting(other.id, NOW);

    const res = await closeDay(testDb, {
      interviewerId: interviewer.id,
      date: "2026-07-10",
      now: NOW,
    });
    expect(res.cancelled).toBe(1);
    expect((await testDb.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      "cancelled_interviewer",
    );

    const victimEntry = await testDb.waitlist.findFirstOrThrow({ where: { userId: victim.id } });
    const otherEntry = await testDb.waitlist.findFirstOrThrow({ where: { userId: other.id } });
    // Пострадавший — раньше обычной заявки (приоритетный якорь createdAt).
    expect(victimEntry.createdAt.getTime()).toBeLessThan(otherEntry.createdAt.getTime());

    // Освободившийся слот предлагается пострадавшему первым.
    const fresh = await createSlot(interviewer.id, addMinutes(NOW, 300));
    await offerSlotToWaitlist(testDb, { slotId: fresh.id, now: NOW });
    const offered = await testDb.waitlist.findFirstOrThrow({ where: { status: "offered" } });
    expect(offered.userId).toBe(victim.id);
  });
});
