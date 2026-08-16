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

export async function createStudent(
  email: string,
  opts: { accessUntil?: Date | null; completedCourse?: boolean } = {},
) {
  const user = await createTestUser({
    email,
    role: "student",
    status: "active",
    accessUntil:
      opts.accessUntil === undefined ? new Date("2027-01-01T00:00:00.000Z") : opts.accessUntil,
    name: "Ученик",
  });
  // Заход B.1: бронь мока открыта только ученику с пройденным курсом. Фикстуры
  // моков по умолчанию дают его — иначе каждый набор о бронях проверял бы не то,
  // что проверяет. Гейт как таковой закрыт отдельным набором (mock-course-gate).
  if (opts.completedCourse !== false) await completeStarterCourse(user.id);
  return user;
}

/**
 * Минимальный пройденный курс: один модуль, один обязательный урок, без
 * модульного теста. «Пройден» считает `isCourseComplete` — тот же предикат, что
 * у цепи курсов и у гейта брони, поэтому фикстура ничего не имитирует.
 */
export async function completeStarterCourse(userId: string): Promise<string> {
  const existing = await testDb.course.findUnique({
    where: { slug: "starter" },
    include: { modules: { include: { lessons: true } } },
  });
  const course =
    existing ??
    (await testDb.course.create({
      data: {
        slug: "starter",
        title: "Стартовый курс",
        gating: "free",
        status: "published",
        order: -1,
        modules: {
          create: [
            {
              title: "Модуль",
              order: 0,
              status: "published",
              lessons: {
                create: [
                  { slug: "s1", title: "Урок", order: 0, status: "published", contentMd: "текст" },
                ],
              },
            },
          ],
        },
      },
      include: { modules: { include: { lessons: true } } },
    }));

  const lessonId = course.modules[0]!.lessons[0]!.id;
  await testDb.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: { status: "completed", completedAt: new Date("2026-01-01T00:00:00.000Z") },
    create: {
      userId,
      lessonId,
      status: "completed",
      completedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  return course.id;
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
