import { beforeEach, describe, expect, it } from "vitest";
import { computeCourseFunnel, computeTopFailedQuestions } from "@/lib/services/admin-analytics";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Аналитика-агрегаторы (spec 7.13/19): воронка (ученик без стартов не в
// знаменателе), топ проваливаемых (мин. 5 попыток — иначе шум).

beforeEach(async () => {
  await resetDb();
});

describe("Воронка курса", () => {
  it("знаменатель — только начавшие курс; доли по достижению урока", async () => {
    const course = await testDb.course.create({
      data: {
        slug: "c",
        title: "C",
        status: "published",
        modules: {
          create: {
            title: "M",
            status: "published",
            lessons: {
              create: [
                { slug: "l1", title: "Урок 1", order: 0, status: "published", contentMd: "x" },
                { slug: "l2", title: "Урок 2", order: 1, status: "published", contentMd: "x" },
                { slug: "l3", title: "Урок 3", order: 2, status: "published", contentMd: "x" },
              ],
            },
          },
        },
      },
      include: { modules: { include: { lessons: { orderBy: { order: "asc" } } } } },
    });
    const [l1, l2, l3] = course.modules[0]!.lessons;

    const a = await createTestUser({ email: "a@t.local" });
    const b = await createTestUser({ email: "b@t.local" });
    const c = await createTestUser({ email: "c@t.local" }); // без прогресса в курсе

    await testDb.lessonProgress.createMany({
      data: [
        { userId: a.id, lessonId: l1!.id, status: "completed" },
        { userId: a.id, lessonId: l2!.id, status: "in_progress" },
        { userId: b.id, lessonId: l1!.id, status: "completed" },
      ],
    });
    // c не имеет прогресса в курсе → не в знаменателе.
    void c;

    const funnel = await computeCourseFunnel(testDb, course.id);
    expect(funnel.started).toBe(2); // только a и b
    expect(funnel.steps.map((s) => s.reached)).toEqual([2, 1, 0]);
    expect(funnel.steps.map((s) => s.pct)).toEqual([100, 50, 0]);
    expect(funnel.steps[2]!.lessonId).toBe(l3!.id);
  });
});

describe("Топ проваливаемых вопросов", () => {
  it("отсекает вопросы с <5 попыток (шум)", async () => {
    const category = await testDb.questionCategory.create({
      data: { title: "Cat", slug: "cat", colorIndex: 0, order: 0 },
    });
    const course = await testDb.course.create({
      data: {
        slug: "c",
        title: "C",
        status: "published",
        modules: {
          create: {
            title: "M",
            status: "published",
            lessons: { create: { slug: "l", title: "L", status: "published", contentMd: "x" } },
          },
        },
      },
      include: { modules: { include: { lessons: true } } },
    });
    const lessonId = course.modules[0]!.lessons[0]!.id;
    const student = await createTestUser({ email: "s@t.local" });

    const qBig = await testDb.question.create({
      data: {
        type: "single",
        categoryId: category.id,
        textMd: "Сложный вопрос",
        status: "published",
        difficulty: 2,
      },
    });
    const qSmall = await testDb.question.create({
      data: {
        type: "single",
        categoryId: category.id,
        textMd: "Редкий вопрос",
        status: "published",
        difficulty: 2,
      },
    });

    // qBig: 6 ответов, 4 неверных (≥5 попыток → в топе)
    const bigAnswers = [false, false, false, false, true, true].map((correct) => ({
      userId: student.id,
      questionId: qBig.id,
      lessonId,
      correct,
    }));
    // qSmall: 3 ответа, все неверные (<5 → отсекается)
    const smallAnswers = [false, false, false].map((correct) => ({
      userId: student.id,
      questionId: qSmall.id,
      lessonId,
      correct,
    }));
    await testDb.quizAnswer.createMany({ data: [...bigAnswers, ...smallAnswers] });

    const top = await computeTopFailedQuestions(testDb, { minAttempts: 5 });
    const ids = top.map((q) => q.id);
    expect(ids).toContain(qBig.id);
    expect(ids).not.toContain(qSmall.id);
    const big = top.find((q) => q.id === qBig.id)!;
    expect(big.total).toBe(6);
    expect(big.failRate).toBeCloseTo(4 / 6, 5);
  });
});
