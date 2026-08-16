import { beforeEach, describe, expect, it } from "vitest";
import { bookMock, joinWaitlist, transferBooking, getBookingLock } from "@/lib/services/mocks";
import { getMockBookingAccess } from "@/lib/services/mock-access";
import { addDays } from "@/lib/utils/dates";
import { resetDb, testDb } from "./helpers/db";
import {
  completeStarterCourse,
  createInterviewer,
  createSlot,
  createStudent,
} from "./helpers/mocks";

// Заход B.1, блок 3: бронь мока открывается после первого пройденного курса.
//
// Гейт живёт в СЕРВИСЕ, а не только на странице: страница — косметика, действие
// — граница (правило захода 13.6, блок 5). Лок за страйки (7.8) остаётся
// отдельным условием со своим сообщением и с этим не смешивается.

const NOW = new Date("2026-08-10T09:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

/** Курс с обязательным уроком, который ученик НЕ прошёл. */
async function makeUnfinishedCourse() {
  return testDb.course.create({
    data: {
      slug: "unfinished",
      title: "Python + PyTorch",
      gating: "free",
      status: "published",
      order: 0,
      modules: {
        create: [
          {
            title: "Модуль",
            order: 0,
            status: "published",
            lessons: {
              create: [
                { slug: "u1", title: "Урок", order: 0, status: "published", contentMd: "текст" },
              ],
            },
          },
        ],
      },
    },
    include: { modules: { include: { lessons: true } } },
  });
}

describe("getMockBookingAccess", () => {
  it("закрыта, пока ни один курс не пройден, и называет текущий курс", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    await makeUnfinishedCourse();

    const access = await getMockBookingAccess(testDb, student.id);
    expect(access.open).toBe(false);
    expect(access.nextCourse?.title).toBe("Python + PyTorch");
  });

  it("открывается ровно тогда, когда курс пройден целиком", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    const course = await makeUnfinishedCourse();
    const lessonId = course.modules[0]!.lessons[0]!.id;

    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(false);

    await testDb.lessonProgress.create({
      data: { userId: student.id, lessonId, status: "completed", completedAt: NOW },
    });
    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(true);
  });

  it("курс без обязательных уроков бронь не открывает (правило цепи 13.6)", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    await testDb.course.create({
      data: {
        slug: "empty",
        title: "Пустой курс",
        gating: "free",
        status: "published",
        order: 0,
        modules: { create: [{ title: "Модуль", order: 0, status: "published" }] },
      },
    });
    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(false);
  });

  it("незавершённый модульный тест держит курс непройденным", async () => {
    const student = await createStudent("s@test.local", { completedCourse: false });
    const course = await makeUnfinishedCourse();
    const moduleId = course.modules[0]!.id;
    const lessonId = course.modules[0]!.lessons[0]!.id;
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
    await testDb.questionLesson.create({ data: { questionId: question.id, lessonId } });
    await testDb.lessonProgress.create({
      data: { userId: student.id, lessonId, status: "completed", completedAt: NOW },
    });

    expect((await getMockBookingAccess(testDb, student.id)).open).toBe(false);
  });
});

describe("действия брони подчиняются гейту", () => {
  it("bookMock отказывает с course_required и не занимает слот", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local", { completedCourse: false });
    await makeUnfinishedCourse();
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

  it("после первого пройденного курса тот же вызов бронирует", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local", { completedCourse: false });
    const slot = await createSlot(interviewer.id, addDays(NOW, 3));

    await completeStarterCourse(student.id);
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
    await completeStarterCourse(student.id);
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
    // Курс пройден (фикстура по умолчанию), но два страйка за 60 дней.
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
