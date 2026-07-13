import { beforeEach, describe, expect, it } from "vitest";
import { completeLesson } from "@/lib/services/content";
import { answerQuizQuestion } from "@/lib/services/questions";
import { answerTestQuestion, startTestAttempt } from "@/lib/services/tests";
import { addSrsCardManually } from "@/lib/services/srs";
import { addDays, dateOnlyUtc } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { CORRECT, makeTestedCourse, WRONG } from "./helpers/content-fixture";

// Обязательный набор этапа 4: источники карточек (spec 7.6) — завершение
// урока, ошибки квиза/теста, ручное добавление; идемпотентность повторных
// срабатываний; правило «новая — сегодня, сброс — завтра».

const NOW = new Date("2026-07-08T12:00:00.000Z"); // Москва: 8 июля, 15:00
const TODAY = dateOnlyUtc("2026-07-08");
const TOMORROW = addDays(TODAY, 1);

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

async function cardOf(userId: string, questionId: string) {
  return testDb.srsCard.findUnique({
    where: { userId_questionId: { userId, questionId } },
  });
}

describe("completeLesson → карточки is_key-вопросов (lesson_key)", () => {
  it("создаёт карточки только для is_key published-вопросов: step 0, next = сегодня", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 3 });
    const [keyId, draftKeyId, plainId] = fixture.questionIds as [string, string, string];
    await testDb.questionLesson.update({
      where: { questionId_lessonId: { questionId: keyId, lessonId: fixture.lesson1Id } },
      data: { isKey: true },
    });
    await testDb.questionLesson.update({
      where: { questionId_lessonId: { questionId: draftKeyId, lessonId: fixture.lesson1Id } },
      data: { isKey: true },
    });
    await testDb.question.update({ where: { id: draftKeyId }, data: { status: "draft" } });

    const result = await completeLesson(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      now: NOW,
    });
    expect(result.ok).toBe(true);

    const key = await cardOf(user.id, keyId);
    expect(key).toMatchObject({
      step: 0,
      addedFrom: "lesson_key",
      lapses: 0,
      reviewsCount: 0,
      suspended: false,
    });
    expect(key!.nextReviewAt).toEqual(TODAY);

    // draft is_key и обычная привязка карточек не получают.
    expect(await cardOf(user.id, draftKeyId)).toBeNull();
    expect(await cardOf(user.id, plainId)).toBeNull();

    const events = await testDb.analyticsEvent.findMany({
      where: { type: "srs.card_added", userId: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ questionId: keyId, source: "lesson_key" });
  });

  it("повторное завершение урока идемпотентно: карточка не плодится и не двигается", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 1 });
    const keyId = fixture.questionIds[0]!;
    await testDb.questionLesson.update({
      where: { questionId_lessonId: { questionId: keyId, lessonId: fixture.lesson1Id } },
      data: { isKey: true },
    });

    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson1Id, now: NOW });
    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson1Id, now: NOW });

    expect(await testDb.srsCard.count({ where: { userId: user.id } })).toBe(1);
    const card = await cardOf(user.id, keyId);
    expect(card!.nextReviewAt).toEqual(TODAY); // не сброшена на «завтра»
    expect(
      await testDb.analyticsEvent.count({ where: { type: "srs.card_added", userId: user.id } }),
    ).toBe(1);
  });

  it("поверх существующей карточки — сброс на step 0, next = завтра, провенанс сохранён", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 1 });
    const keyId = fixture.questionIds[0]!;
    await testDb.questionLesson.update({
      where: { questionId_lessonId: { questionId: keyId, lessonId: fixture.lesson1Id } },
      data: { isKey: true },
    });
    // Живая прокачанная карточка из ручного добавления.
    await addSrsCardManually(testDb, { userId: user.id, questionId: keyId, now: NOW });
    await testDb.srsCard.updateMany({
      where: { userId: user.id, questionId: keyId },
      data: { step: 3, lapses: 2, nextReviewAt: addDays(TODAY, 7) },
    });

    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson1Id, now: NOW });

    const card = await cardOf(user.id, keyId);
    expect(card).toMatchObject({ step: 0, lapses: 2, addedFrom: "manual" });
    expect(card!.nextReviewAt).toEqual(TOMORROW);
  });
});

describe("неверный ответ квиза → quiz_fail (spec 7.5)", () => {
  async function makeQuizFixture() {
    const fixture = await makeTestedCourse({ poolQuestions: 2 });
    const [quizId, otherId] = fixture.questionIds as [string, string];
    await testDb.questionLesson.update({
      where: { questionId_lessonId: { questionId: quizId, lessonId: fixture.lesson1Id } },
      data: { inQuiz: true },
    });
    return { ...fixture, quizId, otherId };
  }

  it("нет карточки — создаёт (step 0, next = сегодня); верный ответ карточку не создаёт", async () => {
    const user = await makeStudent();
    const fixture = await makeQuizFixture();

    await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.quizId,
      answer: WRONG,
      now: NOW,
    });
    const card = await cardOf(user.id, fixture.quizId);
    expect(card).toMatchObject({ step: 0, addedFrom: "quiz_fail", lapses: 0 });
    expect(card!.nextReviewAt).toEqual(TODAY);

    // Верный ответ на второй вопрос — карточки нет.
    await testDb.questionLesson.update({
      where: {
        questionId_lessonId: { questionId: fixture.otherId, lessonId: fixture.lesson1Id },
      },
      data: { inQuiz: true },
    });
    await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.otherId,
      answer: CORRECT,
      now: NOW,
    });
    expect(await cardOf(user.id, fixture.otherId)).toBeNull();
  });

  it("есть карточка — сброс на step 0, next = завтра; lapses не растёт; повторная ошибка не двигает дважды", async () => {
    const user = await makeStudent();
    const fixture = await makeQuizFixture();
    await addSrsCardManually(testDb, { userId: user.id, questionId: fixture.quizId, now: NOW });
    await testDb.srsCard.updateMany({
      where: { userId: user.id, questionId: fixture.quizId },
      data: { step: 4, lapses: 1, nextReviewAt: addDays(TODAY, 16) },
    });

    const wrong = () =>
      answerQuizQuestion(testDb, {
        userId: user.id,
        lessonId: fixture.lesson1Id,
        questionId: fixture.quizId,
        answer: WRONG,
        now: NOW,
      });

    await wrong();
    let card = await cardOf(user.id, fixture.quizId);
    // lapses считает только кнопку «Не знаю» — сброс источника его не трогает.
    expect(card).toMatchObject({ step: 0, lapses: 1, addedFrom: "quiz_fail" });
    expect(card!.nextReviewAt).toEqual(TOMORROW);

    await wrong();
    await wrong();
    card = await cardOf(user.id, fixture.quizId);
    expect(card!.nextReviewAt).toEqual(TOMORROW); // не «послезавтра»
    expect(await testDb.srsCard.count({ where: { userId: user.id } })).toBe(1);
    // srs.card_added только при создании — сбросы события не эмитят.
    expect(
      await testDb.analyticsEvent.count({ where: { type: "srs.card_added", userId: user.id } }),
    ).toBe(1);
  });
});

describe("неверный ответ теста → test_fail (spec 7.5)", () => {
  it("создаёт карточку в момент ответа; верные ответы карточек не создают", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 3 });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("attempt not started");

    const [q1, q2] = fixture.questionIds as [string, string];
    await answerTestQuestion(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      questionId: q1,
      answer: WRONG,
      now: NOW,
    });
    await answerTestQuestion(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      questionId: q2,
      answer: CORRECT,
      now: NOW,
    });

    const failed = await cardOf(user.id, q1);
    expect(failed).toMatchObject({ step: 0, addedFrom: "test_fail" });
    expect(failed!.nextReviewAt).toEqual(TODAY);
    expect(await cardOf(user.id, q2)).toBeNull();
  });

  it("сбрасывает существующую карточку и перештамповывает added_from", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 1 });
    const questionId = fixture.questionIds[0]!;
    await addSrsCardManually(testDb, { userId: user.id, questionId, now: NOW });
    await testDb.srsCard.updateMany({
      where: { userId: user.id, questionId },
      data: { step: 5, nextReviewAt: addDays(TODAY, 90) },
    });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("attempt not started");
    await answerTestQuestion(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      questionId,
      answer: WRONG,
      now: NOW,
    });

    const card = await cardOf(user.id, questionId);
    expect(card).toMatchObject({ step: 0, addedFrom: "test_fail" });
    expect(card!.nextReviewAt).toEqual(TOMORROW);
  });
});

describe("ручное добавление (spec 7.4/7.6)", () => {
  it("новая карточка: added=true, step 0, next = сегодня, manual", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 1 });
    const questionId = fixture.questionIds[0]!;

    const result = await addSrsCardManually(testDb, { userId: user.id, questionId, now: NOW });
    expect(result).toEqual({ ok: true, added: true });

    const card = await cardOf(user.id, questionId);
    expect(card).toMatchObject({ step: 0, addedFrom: "manual", lapses: 0 });
    expect(card!.nextReviewAt).toEqual(TODAY);
  });

  it("поверх живой карточки — no-op: ничего не сбрасывается", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 1 });
    const questionId = fixture.questionIds[0]!;
    await addSrsCardManually(testDb, { userId: user.id, questionId, now: NOW });
    await testDb.srsCard.updateMany({
      where: { userId: user.id, questionId },
      data: { step: 3, lapses: 1, nextReviewAt: addDays(TODAY, 7), addedFrom: "quiz_fail" },
    });

    const repeat = await addSrsCardManually(testDb, { userId: user.id, questionId, now: NOW });
    expect(repeat).toEqual({ ok: true, added: false });

    const card = await cardOf(user.id, questionId);
    expect(card).toMatchObject({ step: 3, lapses: 1, addedFrom: "quiz_fail" });
    expect(card!.nextReviewAt).toEqual(addDays(TODAY, 7));
    expect(
      await testDb.analyticsEvent.count({ where: { type: "srs.card_added", userId: user.id } }),
    ).toBe(1);
  });

  it("черновик и несуществующий вопрос отклоняются", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 1 });
    const questionId = fixture.questionIds[0]!;
    await testDb.question.update({ where: { id: questionId }, data: { status: "draft" } });

    expect(await addSrsCardManually(testDb, { userId: user.id, questionId, now: NOW })).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(
      await addSrsCardManually(testDb, { userId: user.id, questionId: "missing", now: NOW }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});
