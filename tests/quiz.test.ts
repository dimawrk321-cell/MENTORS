import { beforeEach, describe, expect, it } from "vitest";
import { answerQuizQuestion, getQuizQuestionsForLesson } from "@/lib/services/questions";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { CORRECT, makeTestedCourse, WRONG } from "./helpers/content-fixture";

// Mandatory suite (stage 3): разовость quiz first (spec 7.5) + выборка квиза.

const NOW = new Date("2026-07-07T12:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

async function makeStudent(email = "student@test.local") {
  return createTestUser({
    email,
    passwordHash: "unused",
    activatedAt: new Date(NOW.getTime() - 10 * 86_400_000),
    accessUntil: new Date(NOW.getTime() + 80 * 86_400_000),
  });
}

async function makeQuizFixture() {
  const fixture = await makeTestedCourse({ poolQuestions: 2 });
  // Первый вопрос — в квизе, второй — нет.
  const [inQuizId, notInQuizId] = fixture.questionIds;
  await testDb.questionLesson.update({
    where: { questionId_lessonId: { questionId: inQuizId!, lessonId: fixture.lesson1Id } },
    data: { inQuiz: true },
  });
  return { ...fixture, inQuizId: inQuizId!, notInQuizId: notInQuizId! };
}

describe("quiz first (spec 7.5: XP только за первый правильный ответ)", () => {
  it("первый верный → first=true; повторный верный → first=false", async () => {
    const user = await makeStudent();
    const fixture = await makeQuizFixture();

    const first = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inQuizId,
      answer: CORRECT,
    });
    expect(first).toMatchObject({ ok: true, correct: true, first: true });

    const repeat = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inQuizId,
      answer: CORRECT,
    });
    expect(repeat).toMatchObject({ ok: true, correct: true, first: false });

    // Ровно одна запись с first=true (идемпотентность будущего XP).
    expect(
      await testDb.quizAnswer.count({
        where: { userId: user.id, questionId: fixture.inQuizId, first: true },
      }),
    ).toBe(1);
  });

  it("неверный ответ не тратит first; верный после неверного — first=true", async () => {
    const user = await makeStudent();
    const fixture = await makeQuizFixture();

    const wrong = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inQuizId,
      answer: WRONG,
    });
    expect(wrong).toMatchObject({ ok: true, correct: false, first: false });

    const correct = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inQuizId,
      answer: CORRECT,
    });
    expect(correct).toMatchObject({ ok: true, correct: true, first: true });

    // Все попытки записаны (история повторных прохождений).
    expect(
      await testDb.quizAnswer.count({ where: { userId: user.id, questionId: fixture.inQuizId } }),
    ).toBe(2);

    const events = await testDb.analyticsEvent.count({
      where: { type: "quiz.answered", userId: user.id },
    });
    expect(events).toBe(2);
  });

  it("first считается на пользователя: второй ученик получает своё first", async () => {
    const alice = await makeStudent("alice@test.local");
    const bob = await makeStudent("bob@test.local");
    const fixture = await makeQuizFixture();

    const first = await answerQuizQuestion(testDb, {
      userId: alice.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inQuizId,
      answer: CORRECT,
    });
    const second = await answerQuizQuestion(testDb, {
      userId: bob.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inQuizId,
      answer: CORRECT,
    });
    expect(first).toMatchObject({ ok: true, first: true });
    expect(second).toMatchObject({ ok: true, first: true });
  });

  it("вопрос вне квиза отклоняется", async () => {
    const user = await makeStudent();
    const fixture = await makeQuizFixture();
    const result = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.notInQuizId,
      answer: CORRECT,
    });
    expect(result).toEqual({ ok: false, code: "not_found" });
  });
});

describe("выборка квиза (spec 7.5: максимум 7, детерминированно для пользователя)", () => {
  it("режет до 7 и стабильна между вызовами", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 10 });
    await testDb.questionLesson.updateMany({
      where: { lessonId: fixture.lesson1Id },
      data: { inQuiz: true },
    });

    const first = await getQuizQuestionsForLesson(testDb, {
      lessonId: fixture.lesson1Id,
      userId: user.id,
    });
    const second = await getQuizQuestionsForLesson(testDb, {
      lessonId: fixture.lesson1Id,
      userId: user.id,
    });
    expect(first).toHaveLength(7);
    expect(first.map((q) => q.id)).toEqual(second.map((q) => q.id));
  });
});
