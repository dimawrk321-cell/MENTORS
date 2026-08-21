import { beforeEach, describe, expect, it } from "vitest";
import {
  createQuestionForLesson,
  getKeyQuestionsForLesson,
  getQuizQuestionsForLesson,
  setQuestionStatus,
  suggestQuestionCategory,
  validateQuestionForPublish,
  type NewLessonQuestion,
} from "@/lib/services/questions";
import { getModuleQuestionPool } from "@/lib/services/tests";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { makeTestedCourse } from "./helpers/content-fixture";

// Заход C.6, блок 1: создание вопроса из редактора урока.
//
// Главное, что охраняет этот набор, — граница «быстро ≠ дёшево для ученика»:
// быстрый путь заводит ЧЕРНОВИК, и до отдельной публикации вопрос не доезжает
// ни в блок «Ключевые вопросы», ни в квиз, ни в пул модульного теста. Прецедент
// «пывапып» (инцидент 19.08) — ровно про это.

function draft(overrides: Partial<NewLessonQuestion> = {}): NewLessonQuestion {
  return {
    type: "open",
    categoryId: "",
    textMd: "Что такое переобучение?",
    answerMd: "Когда модель запоминает шум обучающей выборки.",
    explanationMd: null,
    options: null,
    acceptedAnswers: null,
    difficulty: 2,
    isKey: true,
    inQuiz: false,
    ...overrides,
  };
}

async function mentor(email = "mentor@c6.test") {
  return createTestUser({ email, role: "mentor" });
}

beforeEach(async () => {
  await resetDb();
});

describe("создание вопроса из редактора урока (заход C.6, 1.1)", () => {
  it("заводит вопрос и сразу привязывает его к уроку с выбранной ролью", async () => {
    const actor = await mentor();
    const fixture = await makeTestedCourse();

    const result = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: fixture.lesson2Id,
      data: draft({ categoryId: fixture.categoryId, isKey: true, inQuiz: false }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const question = await testDb.question.findUniqueOrThrow({ where: { id: result.id } });
    expect(question.status).toBe("draft");
    expect(question.source).toBe("manual");
    expect(question.categoryId).toBe(fixture.categoryId);

    const link = await testDb.questionLesson.findUniqueOrThrow({
      where: { questionId_lessonId: { questionId: result.id, lessonId: fixture.lesson2Id } },
    });
    expect(link.isKey).toBe(true);
    expect(link.inQuiz).toBe(false);
  });

  it("закрытый вопрос сохраняет варианты, отметку правильного и разбор", async () => {
    const actor = await mentor();
    const fixture = await makeTestedCourse();

    const result = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: fixture.lesson2Id,
      data: draft({
        type: "single",
        categoryId: fixture.categoryId,
        answerMd: null,
        explanationMd: "Потому что.",
        options: [
          { id: "a", text: "Верный", correct: true },
          { id: "b", text: "Неверный", correct: false },
        ],
        isKey: false,
        inQuiz: true,
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const question = await testDb.question.findUniqueOrThrow({ where: { id: result.id } });
    expect(question.explanationMd).toBe("Потому что.");
    expect(question.options).toEqual([
      { id: "a", text: "Верный", correct: true },
      { id: "b", text: "Неверный", correct: false },
    ]);
  });

  it("несуществующие категория и урок — отказ, ничего не создаётся", async () => {
    const actor = await mentor();
    const fixture = await makeTestedCourse();

    const noCategory = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: fixture.lesson2Id,
      data: draft({ categoryId: "нет-такой" }),
    });
    expect(noCategory).toEqual({ ok: false, code: "category_not_found" });

    const noLesson = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: "нет-такого",
      data: draft({ categoryId: fixture.categoryId }),
    });
    expect(noLesson).toEqual({ ok: false, code: "not_found" });

    // Ни одного вопроса с текстом черновика не завелось (в фикстуре свои пять).
    expect(await testDb.question.count({ where: { textMd: "Что такое переобучение?" } })).toBe(0);
  });

  it("аудит: создание и привязка от НАСТОЯЩЕГО актора (1.5)", async () => {
    const actor = await mentor("audit@c6.test");
    const fixture = await makeTestedCourse();

    const result = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: fixture.lesson2Id,
      data: draft({ categoryId: fixture.categoryId }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const created = await testDb.auditLog.findFirstOrThrow({
      where: { action: "question.created", entityId: result.id },
    });
    expect(created.actorId).toBe(actor.id);
    expect(created.after).toMatchObject({ status: "draft", via: "lesson_editor" });

    const linked = await testDb.auditLog.findFirstOrThrow({
      where: { action: "question.linked", entityId: fixture.lesson2Id },
    });
    expect(linked.actorId).toBe(actor.id);
    expect(linked.after).toMatchObject({ questionId: result.id });
  });
});

describe("быстрый путь не облегчает черновику дорогу к ученику (заход C.6, 1.2)", () => {
  it("ключевой вопрос доезжает до блока только после отдельной публикации", async () => {
    const actor = await mentor();
    const fixture = await makeTestedCourse();

    const result = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: fixture.lesson2Id,
      data: draft({ categoryId: fixture.categoryId, isKey: true, inQuiz: false }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await getKeyQuestionsForLesson(testDb, fixture.lesson2Id)).toHaveLength(0);

    const published = await setQuestionStatus(testDb, {
      actorId: actor.id,
      questionId: result.id,
      status: "published",
    });
    expect(published.ok).toBe(true);
    expect(await getKeyQuestionsForLesson(testDb, fixture.lesson2Id)).toHaveLength(1);
  });

  it("закрытый вопрос не попадает в боевой пул модуля, пока он черновик", async () => {
    const actor = await mentor();
    const student = await createTestUser({ email: "student@c6.test" });
    const fixture = await makeTestedCourse({ poolQuestions: 0 });

    const result = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: fixture.lesson1Id,
      data: draft({
        type: "single",
        categoryId: fixture.categoryId,
        textMd: "пывапып",
        answerMd: null,
        options: [
          { id: "a", text: "Да", correct: true },
          { id: "b", text: "Нет", correct: false },
        ],
        isKey: false,
        inQuiz: true,
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await getModuleQuestionPool(testDb, fixture.moduleId)).toHaveLength(0);
    expect(
      await getQuizQuestionsForLesson(testDb, { lessonId: fixture.lesson1Id, userId: student.id }),
    ).toHaveLength(0);

    await setQuestionStatus(testDb, {
      actorId: actor.id,
      questionId: result.id,
      status: "published",
    });
    // Публикация — отдельное решение ментора, и только оно открывает пул.
    expect(await getModuleQuestionPool(testDb, fixture.moduleId)).toHaveLength(1);
  });

  it("недоделанный черновик не публикуется: валидатор тот же, что у полного редактора", async () => {
    const actor = await mentor();
    const fixture = await makeTestedCourse();

    const result = await createQuestionForLesson(testDb, {
      actorId: actor.id,
      lessonId: fixture.lesson2Id,
      // Открытый вопрос без эталона — карточка без обратной стороны.
      data: draft({ categoryId: fixture.categoryId, answerMd: "   " }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const question = await testDb.question.findUniqueOrThrow({ where: { id: result.id } });
    expect(validateQuestionForPublish(question)).toContain(
      "У открытого вопроса нет эталонного ответа",
    );

    const attempt = await setQuestionStatus(testDb, {
      actorId: actor.id,
      questionId: result.id,
      status: "published",
    });
    expect(attempt.ok).toBe(false);
    const still = await testDb.question.findUniqueOrThrow({ where: { id: result.id } });
    expect(still.status).toBe("draft");
  });
});

describe("умолчание категории (заход C.6, 1.3)", () => {
  it("берётся по вопросам этого урока, когда они есть", async () => {
    const fixture = await makeTestedCourse();
    const other = await testDb.questionCategory.create({
      data: { title: "Python", slug: "python", colorIndex: 1, order: 1 },
    });
    const lonely = await testDb.question.create({
      data: { type: "open", categoryId: other.id, textMd: "Одиночка", status: "published" },
    });
    await testDb.questionLesson.create({
      data: { questionId: lonely.id, lessonId: fixture.lesson2Id },
    });

    // У урока 2 одна привязка (Python), у урока 1 — пять (Classic ML).
    expect(await suggestQuestionCategory(testDb, fixture.lesson2Id)).toEqual({
      categoryId: other.id,
      scope: "lesson",
    });
  });

  it("нет привязок у урока — берётся по модулю, затем по курсу", async () => {
    const fixture = await makeTestedCourse();

    // Урок 2 своих привязок не имеет, но живёт в модуле урока 1.
    expect(await suggestQuestionCategory(testDb, fixture.lesson2Id)).toEqual({
      categoryId: fixture.categoryId,
      scope: "module",
    });
    // Урок 4 — другой модуль того же курса.
    expect(await suggestQuestionCategory(testDb, fixture.lesson4Id)).toEqual({
      categoryId: fixture.categoryId,
      scope: "course",
    });
  });

  it("в курсе нет ни одной привязки — умолчания нет, ментор выбирает сам", async () => {
    const fixture = await makeTestedCourse({ poolQuestions: 0 });
    expect(await suggestQuestionCategory(testDb, fixture.lesson1Id)).toBeNull();
  });

  it("несуществующий урок — null, а не падение", async () => {
    expect(await suggestQuestionCategory(testDb, "нет-такого")).toBeNull();
  });
});
