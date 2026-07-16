import { addMinutes } from "@/lib/utils/dates";
import { createTestUser, testDb } from "./db";

// Shared fixtures for stage-6 mock tests: interviewer (with profile), student,
// и слот. Держит наборы компактными.

export async function createInterviewer(
  email: string,
  timezone = "Europe/Moscow",
  opts: { active?: boolean; roomUrl?: string } = {},
) {
  const user = await createTestUser({
    email,
    role: "owner",
    isInterviewer: true,
    timezone,
    name: "Интервьюер",
  });
  await testDb.interviewerProfile.create({
    data: {
      userId: user.id,
      roomUrl: opts.roomUrl ?? "https://telemost.yandex.ru/room",
      active: opts.active ?? true,
    },
  });
  return user;
}

export async function createStudent(email: string, opts: { accessUntil?: Date | null } = {}) {
  return createTestUser({
    email,
    role: "student",
    status: "active",
    accessUntil:
      opts.accessUntil === undefined ? new Date("2027-01-01T00:00:00.000Z") : opts.accessUntil,
    name: "Ученик",
  });
}

export async function createSlot(
  interviewerId: string,
  startsAt: Date,
  status: "open" | "booked" | "closed" = "open",
) {
  return testDb.slot.create({
    data: {
      interviewerId,
      startsAt,
      endsAt: addMinutes(startsAt, 60),
      status,
    },
  });
}
