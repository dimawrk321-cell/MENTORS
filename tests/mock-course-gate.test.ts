import { beforeEach, describe, expect, it } from "vitest";
import { bookMock, joinWaitlist, transferBooking, getBookingLock } from "@/lib/services/mocks";
import { getMockBookingAccess } from "@/lib/services/mock-access";
import { listStartingCourseIds } from "@/lib/services/course-access";
import { addDays } from "@/lib/utils/dates";
import { mockLockedText } from "@/lib/constants";
import { resetDb, testDb } from "./helpers/db";
import { createInterviewer, createSlot, createStudent, grantMockAccess } from "./helpers/mocks";

// Заход B.1, блок 3: бронь мока открывается после первого ЗАРАБОТАННОГО курса —
// пройденного курса, который НЕ был доступен ученику с самого начала. Вводный
// курс (голова цепи, открыт всем сразу) бронь не открывает.
//
// Гейт живёт в СЕРВИСЕ, а не только на странице: страница — косметика, действие
// — граница (правило захода 13.6, блок 5). Лок за страйки (7.8) остаётся
// отдельным условием со своим сообщением и с этим не смешивается.

const NOW = new Date("2026-08-10T09:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

interface CourseFixture {
  id: string;
  slug: string;
  modules: { id: string; lessons: { id: string }[] }[];
}

/** Курс с одним обязательным уроком на заданном месте цепи. */
async function makeCourse(
  slug: string,
  title: string,
  order: number,
  opts: { lessons?: number } = {},
): Promise<CourseFixture> {
  const lessons = opts.lessons ?? 1;
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
              create: Array.from({ length: lessons }, (_, i) => ({
                slug: `${slug}-l${i}`,
                title: `Урок ${i + 1}`,
                order: i,
                status: "published" as const,
                contentMd: "текст",
              })),
            },
          },
        ],
      },
    },
    include: { modules: { include: { lessons: true } } },
  });
}

/** Реальная форма стенда: вводный курс в голове, за ним содержательный. */
async function makeChain() {
  const welcome = await makeCourse("welcome", "Знакомство с PRIME", 0);
  const python = await makeCourse("python-pytorch", "Python + PyTorch", 1);
  return { welcome, python };
}

async function complete(userId: string, course: CourseFixture) {
  for (const courseModule of course.modules) {
    for (const lesson of courseModule.lessons) {
      await testDb.lessonProgress.upsert({
        where: { userId_lessonId: { userId, lessonId: lesson.id } },
        update: { status: "completed", completedAt: NOW },
        create: { userId, lessonId: lesson.id, status: "completed", completedAt: NOW },
      });
    }
  }
}

describe("стартовый префикс цепи", () => {
  it("открытым с самого начала считается только вводный курс", async () => {
    const { welcome, python } = await makeChain();
    const starting = await listStartingCourseIds(testDb);
    expect(starting.has(welcome.id)).toBe(true);
    expect(starting.has(python.id)).toBe(false);
  });

  it("пустая голова цепи прозрачна: стартовым становится и следующий курс", async () => {
    // Тот же случай, что ловил аудит 13.6: курс без обязательных уроков нечем
    // закрыть, поэтому он не барьер — и «с самого начала» открыт не он один.
    const empty = await makeCourse("empty", "Пустой", 0, { lessons: 0 });
    const python = await makeCourse("python-pytorch", "Python + PyTorch", 1);
    const starting = await listStartingCourseIds(testDb);
    expect(starting.has(empty.id)).toBe(true);
    expect(starting.has(python.id)).toBe(true);
  });
});

describe("getMockBookingAccess", () => {
  it("вводный курс бронь НЕ открывает и называет курс-цель", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    const { welcome, python } = await makeChain();
    await complete(student.id, welcome);
    // Ровно то, что делает цепь после завершения вводного курса, — иначе
    // следующий курс остался бы locked_chain и «Продолжить курс» вело бы в никуда.
    await testDb.courseAccess.create({
      data: { userId: student.id, courseId: python.id, unlockedAt: NOW, unlockedBy: "system" },
    });

    const access = await getMockBookingAccess(testDb, student.id);
    expect(access.open).toBe(false);
    expect(access.unlockingCourse?.title).toBe("Python + PyTorch");
    // Объяснение называет курс-цель, а не «первый курс» вообще: ученик уже
    // прошёл один курс, и общая формулировка выглядела бы как баг.
    expect(mockLockedText(access.unlockingCourse!.title)).toContain("«Python + PyTorch»");
    expect(access.nextCourse?.title).toBe("Python + PyTorch");
  });

  it("курс-цель не может быть пустым курсом — закрыть его нечем", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    const welcome = await makeCourse("welcome", "Знакомство", 0);
    await makeCourse("empty", "Пустой", 1, { lessons: 0 });
    const real = await makeCourse("nlp", "NLP: базовый курс", 2);
    await complete(student.id, welcome);

    const access = await getMockBookingAccess(testDb, student.id);
    expect(access.open).toBe(false);
    expect(access.unlockingCourse?.slug).toBe(real.slug);
  });

  it("следующий за вводным курс — открывает", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    const { welcome, python } = await makeChain();
    await complete(student.id, welcome);
    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(false);

    await complete(student.id, python);
    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(true);
  });

  it("курс, открытый админом досрочно, тоже засчитывается — он не был доступен сразу", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    const { python } = await makeChain();
    await testDb.courseAccess.create({
      data: { userId: student.id, courseId: python.id, unlockedAt: NOW, unlockedBy: "admin" },
    });
    await complete(student.id, python);

    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(true);
  });

  it("незавершённый модульный тест держит курс непройденным", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    const { welcome, python } = await makeChain();
    const moduleId = python.modules[0]!.id;
    await testDb.moduleTest.create({ data: { moduleId, enabled: true } });
    // Тест с пустым пулом ничего не гейтит (см. makeModuleTestHook) — вопрос обязателен.
    const category = await testDb.questionCategory.create({
      data: { title: "Python", slug: "python", colorIndex: 0, order: 0 },
    });
    const question = await testDb.question.create({
      data: {
        type: "single",
        categoryId: category.id,
        textMd: "Вопрос",
        options: [
          { id: "a", text: "Верно", correct: true },
          { id: "b", text: "Неверно", correct: false },
        ],
        status: "published",
        difficulty: 1,
      },
    });
    await testDb.questionLesson.create({
      data: { questionId: question.id, lessonId: python.modules[0]!.lessons[0]!.id },
    });
    await complete(student.id, welcome);
    await complete(student.id, python);

    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(false);
  });

  it("курс без обязательных уроков бронь не открывает (правило цепи 13.6)", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    await makeCourse("welcome", "Знакомство", 0);
    await makeCourse("empty", "Пустой курс", 1, { lessons: 0 });
    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(false);
  });
});

describe("действия брони подчиняются гейту", () => {
  it("bookMock отказывает с course_required и не занимает слот", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local", { completedCourse: false });
    const { welcome } = await makeChain();
    await complete(student.id, welcome);
    const slot = await createSlot(interviewer.id, addDays(NOW, 3));

    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res).toEqual({ ok: false, code: "course_required" });
    expect((await testDb.slot.findUnique({ where: { id: slot.id } }))!.status).toBe("open");
    expect(await testDb.booking.count()).toBe(0);
  });

  it("после первого заработанного курса тот же вызов бронирует", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local", { completedCourse: false });
    const slot = await createSlot(interviewer.id, addDays(NOW, 3));

    await grantMockAccess(student.id);
    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res.ok).toBe(true);
  });

  it("лист ожидания и перенос закрыты тем же условием", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local", { completedCourse: false });
    const slot = await createSlot(interviewer.id, addDays(NOW, 3));

    expect(await joinWaitlist(testDb, { userId: student.id, type: "theory", now: NOW })).toEqual({
      ok: false,
      code: "course_required",
    });

    // Бронь, созданная до введения правила (курс ещё не пройден).
    await grantMockAccess(student.id);
    const booked = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(booked.ok).toBe(true);
    await testDb.lessonProgress.deleteMany({ where: { userId: student.id } });

    const other = await createSlot(interviewer.id, addDays(NOW, 4));
    const moved = await transferBooking(testDb, {
      userId: student.id,
      bookingId: booked.ok ? booked.bookingId : "",
      newSlotId: other.id,
      now: NOW,
    });
    expect(moved).toEqual({ ok: false, code: "course_required" });
    // Старая бронь цела — правило запрещает занять новый слот, а не отнимает мок.
    expect(await testDb.booking.count({ where: { status: "booked" } })).toBe(1);
  });

  it("лок за страйки — отдельное условие: у пройденного курса своя причина отказа", async () => {
    const interviewer = await createInterviewer("i@test.local");
    // Курс заработан (фикстура по умолчанию), но два страйка за 60 дней.
    const student = await createStudent("s@test.local");
    const slot = await createSlot(interviewer.id, addDays(NOW, 3));
    for (const daysAgo of [10, 5]) {
      const past = await createSlot(interviewer.id, addDays(NOW, -daysAgo), "booked");
      const booking = await testDb.booking.create({
        data: {
          slotId: past.id,
          userId: student.id,
          type: "theory",
          status: "no_show",
          roomUrl: "https://telemost.yandex.ru/room",
        },
      });
      await testDb.bookingStrike.create({
        data: {
          userId: student.id,
          bookingId: booking.id,
          reason: "no_show",
          createdAt: addDays(NOW, -daysAgo),
        },
      });
    }

    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(true);
    expect(await getBookingLock(testDb, student.id, NOW)).not.toBeNull();
    const res = await bookMock(testDb, {
      userId: student.id,
      slotId: slot.id,
      type: "theory",
      now: NOW,
    });
    expect(res).toEqual({ ok: false, code: "locked" });
  });
});
