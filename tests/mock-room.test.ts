import { beforeEach, describe, expect, it } from "vitest";
import { bookMock } from "@/lib/services/mocks";
import { upsertInterviewerProfile } from "@/lib/services/mock-admin";
import { isRoomUrlReady, ROOM_URL_PLACEHOLDER } from "@/lib/constants";
import { addMinutes } from "@/lib/utils/dates";
import { resetDb, testDb } from "./helpers/db";
import { createInterviewer, createSlot, createStudent } from "./helpers/mocks";

// Acceptance-фикс этапа 6: плейсхолдерный room_url не блокирует бронь, а при
// сохранении настоящей ссылки она мигрирует в будущие booked-брони (аудит одной записью).

const NOW = new Date("2026-07-08T12:00:00.000Z");
const REAL_URL = "https://telemost.yandex.ru/real-room-123";

beforeEach(async () => {
  await resetDb();
});

describe("бронь с плейсхолдерной комнатой (фикс а)", () => {
  it("бронирование разрешено, бронь копирует плейсхолдер, isRoomUrlReady=false", async () => {
    const interviewer = await createInterviewer("i@test.local", "Europe/Moscow", {
      roomUrl: ROOM_URL_PLACEHOLDER,
    });
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));

    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res.ok).toBe(true);
    const booking = await testDb.booking.findFirstOrThrow({ where: { userId: student.id } });
    expect(booking.roomUrl).toBe(ROOM_URL_PLACEHOLDER);
    expect(isRoomUrlReady(booking.roomUrl)).toBe(false);
  });

  it("неактивный профиль по-прежнему блокирует бронь (no_room)", async () => {
    const interviewer = await createInterviewer("i@test.local", "Europe/Moscow", {
      roomUrl: ROOM_URL_PLACEHOLDER,
      active: false,
    });
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));
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

describe("миграция room_url в будущие брони (фикс в)", () => {
  it("сохранение настоящей ссылки обновляет будущие booked-брони; прошлые/завершённые — нет; аудит одной записью", async () => {
    const interviewer = await createInterviewer("i@test.local", "Europe/Moscow", {
      roomUrl: ROOM_URL_PLACEHOLDER,
    });
    const student = await createStudent("s@test.local");

    // Будущая booked-бронь с плейсхолдером (через bookMock).
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));
    const booked = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    if (!booked.ok) throw new Error("booking failed");

    // Прошедшая завершённая бронь с плейсхолдером — не должна мигрировать.
    const pastStart = addMinutes(NOW, -300);
    const completed = await testDb.booking.create({
      data: {
        slot: {
          create: {
            interviewerId: interviewer.id,
            startsAt: pastStart,
            endsAt: addMinutes(pastStart, 60),
            status: "booked",
          },
        },
        user: { connect: { id: student.id } },
        type: "theory",
        status: "completed",
        roomUrl: ROOM_URL_PLACEHOLDER,
      },
    });

    const res = await upsertInterviewerProfile(testDb, {
      actorId: interviewer.id,
      userId: interviewer.id,
      roomUrl: REAL_URL,
      active: true,
      now: NOW,
    });
    expect(res.ok).toBe(true);

    // Будущая booked — мигрирована.
    expect(
      (await testDb.booking.findUniqueOrThrow({ where: { id: booked.bookingId } })).roomUrl,
    ).toBe(REAL_URL);
    // Прошедшая завершённая — не тронута.
    expect((await testDb.booking.findUniqueOrThrow({ where: { id: completed.id } })).roomUrl).toBe(
      ROOM_URL_PLACEHOLDER,
    );
    // Профиль обновлён.
    expect(
      (await testDb.interviewerProfile.findUniqueOrThrow({ where: { userId: interviewer.id } }))
        .roomUrl,
    ).toBe(REAL_URL);
    // Одна аудит-запись миграции.
    const audits = await testDb.auditLog.findMany({
      where: { action: "interviewer.room_url_migrated" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ roomUrl: REAL_URL, bookingsUpdated: 1 });
  });

  it("сохранение плейсхолдера НЕ переносит его в брони (не портит готовую ссылку)", async () => {
    const interviewer = await createInterviewer("i@test.local", "Europe/Moscow", {
      roomUrl: REAL_URL,
    });
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, addMinutes(NOW, 200));
    const booked = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    if (!booked.ok) throw new Error("booking failed");

    await upsertInterviewerProfile(testDb, {
      actorId: interviewer.id,
      userId: interviewer.id,
      roomUrl: ROOM_URL_PLACEHOLDER,
      active: true,
      now: NOW,
    });

    // Бронь сохраняет настоящую ссылку — плейсхолдер не мигрирует.
    expect(
      (await testDb.booking.findUniqueOrThrow({ where: { id: booked.bookingId } })).roomUrl,
    ).toBe(REAL_URL);
    expect(
      await testDb.auditLog.count({ where: { action: "interviewer.room_url_migrated" } }),
    ).toBe(0);
  });
});
