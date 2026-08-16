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
  // Заход B.1: бронь мока открыта только ученику, прошедшему курс, который НЕ
  // был доступен ему с самого начала. Фикстуры моков по умолчанию дают такой
  // курс — иначе каждый набор о бронях проверял бы не то, что проверяет. Сам
  // гейт закрыт отдельным набором (mock-course-gate).
  if (opts.completedCourse !== false) await grantMockAccess(user.id);
  return user;
}

/** Курс с одним обязательным опубликованным уроком, без модульного теста. */
async function ensureCourse(slug: string, title: string, order: number) {
  const existing = await testDb.course.findUnique({
    where: { slug },
    include: { modules: { include: { lessons: true } } },
  });
  if (existing) return existing;
  return testDb.course.create({
    data: {
      slug,
      title,
      gating: "free",
      status: "published",
      order,
      modules: {
        create: [
          {
            title: "Модуль",
            order: 0,
            status: "published",
            lessons: {
              create: [
                {
                  slug: slug + "-l1",
                  title: "Урок",
                  order: 0,
                  status: "published",
                  contentMd: "текст",
                },
              ],
            },
          },
        ],
      },
    },
    include: { modules: { include: { lessons: true } } },
  });
}

async function completeCourse(
  userId: string,
  course: { modules: { lessons: { id: string }[] }[] },
) {
  const completedAt = new Date("2026-01-01T00:00:00.000Z");
  for (const courseModule of course.modules) {
    for (const lesson of courseModule.lessons) {
      await testDb.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
        update: { status: "completed", completedAt },
        create: { userId, lessonId: lesson.id, status: "completed", completedAt },
      });
    }
  }
}

/**
 * Минимальная цепь под гейт брони (заход B.1): вводный курс, открытый с самого
 * начала, и следующий за ним «заработанный». Проходятся оба — бронь открывает
 * именно второй. Отрицательные `order` держат пару в голове цепи, чтобы курсы,
 * которые заводит сам набор тестов, оказывались ЗА ними и стартовыми не
 * считались. «Пройден» считает `isCourseComplete` — фикстура ничего не имитирует.
 */
export async function grantMockAccess(userId: string): Promise<string> {
  const starting = await ensureCourse("starter", "Вводный курс", -100);
  const earned = await ensureCourse("earned", "Заработанный курс", -99);
  await completeCourse(userId, starting);
  await completeCourse(userId, earned);
  return earned.id;
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
