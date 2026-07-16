import { beforeEach, describe, expect, it } from "vitest";
import { completeMock } from "@/lib/services/mocks";
import { addMinutes } from "@/lib/utils/dates";
import { resetDb, testDb } from "./helpers/db";
import { createInterviewer, createStudent } from "./helpers/mocks";

// Обязательный набор этапа 6: завершение мока (spec 7.8) — отметки partial|failed →
// SRS (source=mock); mock-урок закрывается завершением мока; идемпотентность XP.

const NOW = new Date("2026-07-08T12:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

async function makeCategory() {
  return testDb.questionCategory.create({
    data: { title: "Classic ML", slug: "classic-ml", colorIndex: 0, order: 0 },
  });
}

async function makeQuestion(categoryId: string, text: string) {
  return testDb.question.create({
    data: { type: "open", categoryId, textMd: text, status: "published", source: "manual" },
  });
}

async function makeBooking(interviewerId: string, studentId: string) {
  const start = addMinutes(NOW, -30);
  return testDb.booking.create({
    data: {
      slot: {
        create: { interviewerId, startsAt: start, endsAt: addMinutes(start, 60), status: "booked" },
      },
      user: { connect: { id: studentId } },
      type: "theory",
      status: "booked",
      roomUrl: "https://telemost.yandex.ru/room",
    },
  });
}

describe("отметки → SRS (spec 7.8)", () => {
  it("partial/failed заводят карточку (source=mock, step 0), answered — нет", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const category = await makeCategory();
    const qPartial = await makeQuestion(category.id, "Вопрос частично");
    const qAnswered = await makeQuestion(category.id, "Вопрос отвечен");
    const booking = await makeBooking(interviewer.id, student.id);

    await testDb.mockQuestionMark.createMany({
      data: [
        { bookingId: booking.id, questionId: qPartial.id, mark: "partial" },
        { bookingId: booking.id, questionId: qAnswered.id, mark: "answered" },
      ],
    });

    const res = await completeMock(testDb, {
      interviewerId: interviewer.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(res.ok).toBe(true);

    const partialCard = await testDb.srsCard.findUnique({
      where: { userId_questionId: { userId: student.id, questionId: qPartial.id } },
    });
    expect(partialCard).toMatchObject({ addedFrom: "mock", step: 0 });
    expect(
      await testDb.srsCard.findUnique({
        where: { userId_questionId: { userId: student.id, questionId: qAnswered.id } },
      }),
    ).toBeNull();
  });
});

describe("идемпотентность XP за мок (spec 7.7/7.8)", () => {
  it("mock.completed начисляет +200 один раз на бронь", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const booking = await makeBooking(interviewer.id, student.id);

    const first = await completeMock(testDb, {
      interviewerId: interviewer.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(first.ok).toBe(true);

    const xp = await testDb.xpEvent.findMany({
      where: { userId: student.id, type: "mock.completed" },
    });
    expect(xp).toHaveLength(1);
    expect(xp[0]).toMatchObject({ amount: 200, refType: "booking", refId: booking.id });

    // Повторное завершение отклоняется — статус уже completed.
    const second = await completeMock(testDb, {
      interviewerId: interviewer.id,
      bookingId: booking.id,
      now: NOW,
    });
    expect(second.ok).toBe(false);
    expect(
      await testDb.xpEvent.count({ where: { userId: student.id, type: "mock.completed" } }),
    ).toBe(1);
  });
});

describe("мок-урок закрывается завершением мока (spec 7.3)", () => {
  it("незавершённый мок-урок соответствующего типа помечается completed", async () => {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");

    const course = await testDb.course.create({
      data: {
        slug: "soft-skills",
        title: "Soft Skills",
        gating: "free",
        status: "published",
        modules: {
          create: {
            title: "Основной",
            status: "published",
            lessons: {
              create: {
                slug: "mock-legend-lesson",
                title: "Мок по легенде",
                status: "published",
                contentMd: "Практика этого урока — мок.\n\n:::mock{type=theory}\n:::\n",
              },
            },
          },
        },
      },
      include: { modules: { include: { lessons: true } } },
    });
    const lessonId = course.modules[0]!.lessons[0]!.id;

    const booking = await makeBooking(interviewer.id, student.id);
    await completeMock(testDb, { interviewerId: interviewer.id, bookingId: booking.id, now: NOW });

    const progress = await testDb.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: student.id, lessonId } },
    });
    expect(progress?.status).toBe("completed");
  });
});
