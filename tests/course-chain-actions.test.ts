import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { setAdminLock } from "@/lib/services/course-access";

// Audit findings (block 5 over 2v2): the quiz action and the «новый урок»
// fan-out were the two surfaces the chain did not cover. Both are exercised
// against the real services here.

const { currentUser } = vi.hoisted(() => ({ currentUser: { id: "" } }));

vi.mock("@/lib/db", async () => {
  const { testDb: db } = await import("./helpers/db");
  return { prisma: db };
});

vi.mock("@/lib/auth/action-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/action-helpers")>(
    "@/lib/auth/action-helpers",
  );
  return {
    ...actual,
    requireActionStudent: async () => ({
      user: { id: currentUser.id, role: "student" },
      session: { id: "s" },
      impersonated: false,
      accessExpired: false,
    }),
    assertNotImpersonating: () => {},
    assertActiveAccess: () => {},
  };
});

async function seed() {
  const welcome = await testDb.course.create({
    data: { slug: "welcome", title: "Знакомство", order: 0, status: "published", gating: "free" },
  });
  const wMod = await testDb.module.create({
    data: { courseId: welcome.id, title: "М", order: 0, status: "published" },
  });
  const wLesson = await testDb.lesson.create({
    data: {
      moduleId: wMod.id,
      slug: "w",
      title: "Урок welcome",
      order: 0,
      status: "published",
      contentMd: "текст",
    },
  });
  const python = await testDb.course.create({
    data: { slug: "python", title: "Python", order: 1, status: "published", gating: "free" },
  });
  const pMod = await testDb.module.create({
    data: { courseId: python.id, title: "М", order: 0, status: "published" },
  });
  const pLesson = await testDb.lesson.create({
    data: {
      moduleId: pMod.id,
      slug: "p",
      title: "Секретный урок Python",
      order: 0,
      status: "published",
      contentMd: "текст",
    },
  });
  const category = await testDb.questionCategory.create({
    data: { title: "Кат", slug: "kat", colorIndex: 0, order: 0 },
  });
  const question = await testDb.question.create({
    data: {
      type: "single",
      categoryId: category.id,
      textMd: "2+2?",
      answerMd: "4",
      status: "published",
      difficulty: 1,
      options: [
        { id: "a", text: "4", correct: true },
        { id: "b", text: "5", correct: false },
      ],
    },
  });
  return { welcome, wLesson, python, pLesson, question };
}

describe("answerQuizAction respects the course chain", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses a quiz inside a locked course — no XP, no answer row", async () => {
    const { pLesson, question } = await seed();
    const user = await createTestUser({ email: "quiz-locked@test.local" });
    currentUser.id = user.id;
    await testDb.questionLesson.create({
      data: { questionId: question.id, lessonId: pLesson.id, inQuiz: true },
    });

    const { answerQuizAction } = await import("@/lib/actions/quiz-tests");
    const res = await answerQuizAction({
      lessonId: pLesson.id,
      questionId: question.id,
      answer: "a",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toBe("Курс ещё закрыт");
    expect(await testDb.quizAnswer.count({ where: { userId: user.id } })).toBe(0);
    expect(await testDb.xpEvent.count({ where: { userId: user.id } })).toBe(0);
  });

  it("allows it in the open first course", async () => {
    const { wLesson, question } = await seed();
    const user = await createTestUser({ email: "quiz-open@test.local" });
    currentUser.id = user.id;
    await testDb.questionLesson.create({
      data: { questionId: question.id, lessonId: wLesson.id, inQuiz: true },
    });

    const { answerQuizAction } = await import("@/lib/actions/quiz-tests");
    const res = await answerQuizAction({
      lessonId: wLesson.id,
      questionId: question.id,
      answer: "a",
    });

    expect(res.ok).toBe(true);
    expect(await testDb.quizAnswer.count({ where: { userId: user.id } })).toBe(1);
  });

  it("stops earning the moment an admin locks the course mid-session", async () => {
    const { welcome, wLesson, question } = await seed();
    const user = await createTestUser({ email: "quiz-midlock@test.local" });
    currentUser.id = user.id;
    await testDb.questionLesson.create({
      data: { questionId: question.id, lessonId: wLesson.id, inQuiz: true },
    });
    await setAdminLock(testDb as never, {
      userId: user.id,
      courseId: welcome.id,
      locked: true,
    });

    const { answerQuizAction } = await import("@/lib/actions/quiz-tests");
    const res = await answerQuizAction({
      lessonId: wLesson.id,
      questionId: question.id,
      answer: "a",
    });
    expect(res.ok).toBe(false);
  });
});

describe("«новый урок» is not announced for locked courses", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("notifies only students who can open the course", async () => {
    const { python, pLesson } = await seed();
    const newcomer = await createTestUser({ email: "notify-newcomer@test.local" });
    const ahead = await createTestUser({ email: "notify-ahead@test.local" });
    await testDb.courseAccess.create({
      data: {
        userId: ahead.id,
        courseId: python.id,
        unlockedAt: new Date(),
        unlockedBy: "system",
      },
    });

    const { notifyLessonPublished } = await import("@/lib/services/content-admin");
    await notifyLessonPublished(testDb as never, pLesson.id);

    const forNewcomer = await testDb.notification.findMany({ where: { userId: newcomer.id } });
    const forAhead = await testDb.notification.findMany({ where: { userId: ahead.id } });

    expect(forAhead).toHaveLength(1);
    expect(forNewcomer).toHaveLength(0);
    // The lesson title must not have reached the locked-out student anywhere.
    expect(JSON.stringify(forNewcomer)).not.toContain("Секретный урок");
  });
});
