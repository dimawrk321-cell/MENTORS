import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import {
  buildFreeTrainingSet,
  finishFreeTraining,
  listFreeTrainingSources,
} from "@/lib/services/free-training";

// Заход «Банк вопросов», блок B — свободная тренировка. Правила из changelog к
// 7.6: набор только из доступного, ошибки кормят SRS, XP не начисляется, стрик
// засчитывает только основная очередь, дневная очередь не расходуется.

let studentId = "";
let openCategoryId = "";
let subCategoryId = "";
let lockedCategoryId = "";
let lockedCourseId = "";

async function makeCourse(slug: string, title: string, order: number) {
  return testDb.course.create({
    data: {
      slug,
      title,
      order,
      gating: "free",
      status: "published",
      modules: {
        create: [
          {
            title: "Модуль",
            order: 0,
            status: "published",
            lessons: {
              create: [
                {
                  slug: `${slug}-l1`,
                  title: "Урок",
                  order: 0,
                  contentMd: "текст",
                  status: "published",
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

async function makeQuestion(
  categoryId: string,
  textMd: string,
  status: "draft" | "published" = "published",
) {
  return testDb.question.create({
    data: { type: "open", categoryId, textMd, answerMd: "эталон", status, difficulty: 1 },
  });
}

beforeEach(async () => {
  await resetDb();
  const student = await createTestUser({
    email: "student@test.local",
    passwordHash: "unused",
    activatedAt: new Date("2026-07-01T00:00:00.000Z"),
    accessUntil: new Date("2027-07-01T00:00:00.000Z"),
  });
  studentId = student.id;

  const openCourse = await makeCourse("open", "Открытый курс", 0);
  lockedCourseId = (await makeCourse("locked", "Запертый курс", 1)).id;
  // Заход «Доступ к вопросам»: категорию целиком открывает ПРОЙДЕННЫЙ курс, а
  // не просто открытый, — иначе набор по категории был бы пуст.
  await testDb.lessonProgress.create({
    data: {
      userId: studentId,
      lessonId: openCourse.modules[0]!.lessons[0]!.id,
      status: "completed",
      completedAt: new Date(),
    },
  });

  openCategoryId = (
    await testDb.questionCategory.create({
      data: { title: "Открытая", slug: "open-cat", colorIndex: 0, order: 0 },
    })
  ).id;
  subCategoryId = (
    await testDb.questionCategory.create({
      data: {
        title: "Подкатегория",
        slug: "open-sub",
        colorIndex: 0,
        order: 1,
        parentId: openCategoryId,
      },
    })
  ).id;
  lockedCategoryId = (
    await testDb.questionCategory.create({
      data: { title: "Запертая", slug: "locked-cat", colorIndex: 1, order: 2 },
    })
  ).id;

  await testDb.courseQuestionCategory.createMany({
    data: [
      { courseId: openCourse.id, categoryId: openCategoryId },
      { courseId: lockedCourseId, categoryId: lockedCategoryId },
    ],
  });

  await makeQuestion(openCategoryId, "Открытый 1");
  await makeQuestion(openCategoryId, "Открытый 2");
  await makeQuestion(subCategoryId, "Из подкатегории");
  await makeQuestion(openCategoryId, "Черновик", "draft");
  await makeQuestion(lockedCategoryId, "Запертый");
});

describe("наборы прогона показывают только доступное", () => {
  it("категории запертых курсов в списке наборов отсутствуют", async () => {
    const sources = await listFreeTrainingSources(testDb, studentId);
    expect(sources.categories.map((c) => c.title)).toContain("Открытая");
    expect(sources.categories.map((c) => c.title)).not.toContain("Запертая");
  });

  it("счётчик категории считает подкатегории и только опубликованные", async () => {
    const sources = await listFreeTrainingSources(testDb, studentId);
    const open = sources.categories.find((c) => c.title === "Открытая");
    // 2 своих + 1 из подкатегории; черновик не в счёт.
    expect(open?.questions).toBe(3);
  });

  it("запертый курс в наборах по курсу не предлагается", async () => {
    const sources = await listFreeTrainingSources(testDb, studentId);
    expect(sources.courses.some((c) => c.id === lockedCourseId)).toBe(false);
  });
});

describe("сбор набора", () => {
  it("набор по категории включает подкатегории и не берёт черновики", async () => {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "category", categoryId: openCategoryId },
      size: "all",
    });
    const texts = set.map((q) => q.textMd);
    expect(texts).toHaveLength(3);
    expect(texts).toContain("Из подкатегории");
    expect(texts).not.toContain("Черновик");
  });

  it("запертая категория не протекает в набор даже при прямом запросе", async () => {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "category", categoryId: lockedCategoryId },
      size: "all",
    });
    expect(set).toEqual([]);
  });

  it("размер ограничивает набор", async () => {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "category", categoryId: openCategoryId },
      size: 10,
    });
    expect(set.length).toBeLessThanOrEqual(10);
    expect(set).toHaveLength(3);
  });
});

describe("итог прогона: правила B5", () => {
  async function answerAll(grades: ("again" | "hard" | "good")[]) {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "category", categoryId: openCategoryId },
      size: "all",
    });
    return finishFreeTraining(testDb, {
      userId: studentId,
      answers: set.map((q, i) => ({ questionId: q.id, grade: grades[i] ?? "good" })),
    });
  }

  it("«не знаю» и «сомневаюсь» заводят карточку в SRS, «знаю» — нет", async () => {
    const result = await answerAll(["again", "hard", "good"]);
    expect(result.again).toBe(1);
    expect(result.hard).toBe(1);
    expect(result.good).toBe(1);
    expect(result.addedToSrs).toBe(2);
    expect(await testDb.srsCard.count({ where: { userId: studentId } })).toBe(2);
  });

  it("живую карточку прогон не сбрасывает", async () => {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "category", categoryId: openCategoryId },
      size: "all",
    });
    const target = set[0]!;
    const card = await testDb.srsCard.create({
      data: {
        userId: studentId,
        questionId: target.id,
        step: 3,
        nextReviewAt: new Date("2027-01-01T00:00:00.000Z"),
        addedFrom: "manual",
      },
    });
    const result = await finishFreeTraining(testDb, {
      userId: studentId,
      answers: [{ questionId: target.id, grade: "again" }],
    });
    expect(result.addedToSrs).toBe(0);
    const after = await testDb.srsCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(after.step).toBe(3);
    expect(after.nextReviewAt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("XP за прогон не начисляется", async () => {
    await answerAll(["good", "good", "good"]);
    expect(await testDb.xpEvent.count({ where: { userId: studentId } })).toBe(0);
  });

  it("день в стрик прогоном не засчитывается", async () => {
    await answerAll(["again", "good", "good"]);
    const streak = await testDb.streak.findUnique({ where: { userId: studentId } });
    expect(streak?.current ?? 0).toBe(0);
  });

  it("из событий пишется только «карточка заведена» — ни ответа, ни закрытия очереди", async () => {
    // srs.card_added — тот же самый эмит, что у ручной кнопки «В повторения»:
    // он не в STREAK_QUALIFYING_EVENTS и не в XP-карте, поэтому безопасен.
    await answerAll(["again", "hard", "good"]);
    const events = await testDb.analyticsEvent.findMany({
      where: { userId: studentId },
      select: { type: true },
    });
    expect([...new Set(events.map((e) => e.type))]).toEqual(["srs.card_added"]);
  });

  it("прогон не расходует дневную очередь (srs_reviews не пишутся)", async () => {
    await answerAll(["again", "hard", "good"]);
    expect(await testDb.srsReview.count({ where: { card: { userId: studentId } } })).toBe(0);
  });

  it("разбивка по категориям ставит худшие сверху и собирает слабые вопросы", async () => {
    const result = await answerAll(["again", "hard", "good"]);
    expect(result.byCategory[0]!.title).toBe("Открытая");
    expect(result.byCategory[0]!.missed).toBe(2);
    expect(result.weakQuestionIds).toHaveLength(2);
  });
});
