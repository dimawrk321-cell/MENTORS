import { beforeEach, describe, expect, it } from "vitest";
import { extractInlineQuestionIds, isInlineQuestionOfLesson } from "@/lib/content/inline-questions";
import {
  answerQuizQuestion,
  getInlineQuestionsForLesson,
  getQuizQuestionsForLesson,
} from "@/lib/services/questions";
import { parse, serialize } from "@/lib/content/markdown-blocks";
import { saveLessonContent } from "@/lib/services/content-admin";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { CORRECT, makeTestedCourse, WRONG } from "./helpers/content-fixture";

// Заход B.1, блок 2: вопрос с вариантами внутри текста урока.
//
// Связь «урок ↔ вставленный вопрос» новой таблицей НЕ заводится — источник
// правды сам markdown урока, поэтому чтение (что рисовать) и запись (кому
// разрешено отвечать) обязаны читать его одним и тем же кодом.

const NOW = new Date("2026-07-07T12:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

async function makeStudent(email = "inline@test.local") {
  return createTestUser({
    email,
    passwordHash: "unused",
    activatedAt: new Date(NOW.getTime() - 10 * 86_400_000),
    accessUntil: new Date(NOW.getTime() + 80 * 86_400_000),
  });
}

/** Урок с директивой в тексте; вопрос НЕ привязан через question_lessons. */
async function makeInlineFixture() {
  const fixture = await makeTestedCourse({ poolQuestions: 2 });
  const [inlineId, quizId] = fixture.questionIds as [string, string];
  // Второй вопрос — обычный «в квизе», чтобы блок «Проверь себя» был не пуст.
  await testDb.questionLesson.update({
    where: { questionId_lessonId: { questionId: quizId, lessonId: fixture.lesson1Id } },
    data: { inQuiz: true },
  });
  // Первый — только директивой в тексте, привязку удаляем совсем.
  await testDb.questionLesson.delete({
    where: { questionId_lessonId: { questionId: inlineId, lessonId: fixture.lesson1Id } },
  });
  const contentMd = `Текст урока.\n\n:::question{id="${inlineId}"}\n:::\n\nПродолжение.\n`;
  await testDb.lesson.update({
    where: { id: fixture.lesson1Id },
    data: { contentMd },
  });
  return { ...fixture, inlineId, quizId, contentMd };
}

describe("разбор директивы", () => {
  it("собирает id по порядку, без повторов и без пустых", () => {
    const md =
      ':::question{id="a"}\n:::\n:::question{id=b}\n:::\n:::question{id="a"}\n:::\n:::question{id=""}\n:::\n';
    expect(extractInlineQuestionIds(md)).toEqual(["a", "b"]);
  });

  it("не путает директиву с текстом о ней", () => {
    expect(extractInlineQuestionIds("Пишем :::question без атрибутов\n")).toEqual([]);
    expect(isInlineQuestionOfLesson('- `:::question{id="x"}` — так вставляют вопрос\n', "x")).toBe(
      true,
    );
  });
});

describe("вставленный вопрос доходит до ученика", () => {
  it("отдаётся рендеру, хотя привязки question_lessons нет", async () => {
    const fixture = await makeInlineFixture();
    const map = await getInlineQuestionsForLesson(testDb, fixture.contentMd);
    expect(map.get(fixture.inlineId)?.question?.id).toBe(fixture.inlineId);
    expect(map.get(fixture.inlineId)?.problem).toBeNull();
  });

  it("ответ проверяется сервером и пишется в quiz_answers", async () => {
    const user = await makeStudent();
    const fixture = await makeInlineFixture();

    const wrong = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inlineId,
      answer: WRONG,
    });
    expect(wrong).toMatchObject({ ok: true, correct: false });

    const right = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inlineId,
      answer: CORRECT,
    });
    expect(right).toMatchObject({ ok: true, correct: true, first: true });

    expect(
      await testDb.quizAnswer.count({ where: { userId: user.id, questionId: fixture.inlineId } }),
    ).toBe(2);
    // Неверный ответ завёл карточку в SRS — как у обычного квиза (spec 7.5).
    expect(
      await testDb.srsCard.count({ where: { userId: user.id, questionId: fixture.inlineId } }),
    ).toBe(1);
  });

  it("чужой вопрос без директивы и без привязки не отвечается", async () => {
    const user = await makeStudent();
    const fixture = await makeInlineFixture();
    const foreign = await testDb.question.create({
      data: {
        type: "single",
        categoryId: fixture.categoryId,
        textMd: "Чужой",
        options: [
          { id: CORRECT, text: "a", correct: true },
          { id: WRONG, text: "b", correct: false },
        ],
        status: "published",
        difficulty: 1,
      },
    });
    const res = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: foreign.id,
      answer: CORRECT,
    });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });

  it("черновик и вопрос без вариантов в текст не пускаются", async () => {
    const user = await makeStudent();
    const fixture = await makeInlineFixture();
    await testDb.question.update({
      where: { id: fixture.inlineId },
      data: { status: "draft" },
    });

    const map = await getInlineQuestionsForLesson(testDb, fixture.contentMd);
    expect(map.get(fixture.inlineId)?.problem).toBe("unpublished");
    expect(
      await answerQuizQuestion(testDb, {
        userId: user.id,
        lessonId: fixture.lesson1Id,
        questionId: fixture.inlineId,
        answer: CORRECT,
      }),
    ).toEqual({ ok: false, code: "not_found" });

    await testDb.question.update({
      where: { id: fixture.inlineId },
      data: { status: "published", type: "open", answerMd: "Эталон" },
    });
    const openMap = await getInlineQuestionsForLesson(testDb, fixture.contentMd);
    expect(openMap.get(fixture.inlineId)?.problem).toBe("not_closed");
  });
});

describe("открытие урока в редакторе ничего не рассылает", () => {
  it("parse → serialize опубликованного урока с обоими новыми блоками = no-op", async () => {
    const fixture = await makeInlineFixture();
    const contentMd =
      `Вступление.\n\n:::spoiler{title="Почему так?"}\nПотому что.\n:::\n\n` +
      `:::question{id="${fixture.inlineId}"}\n:::\n\n\`\`\`python\nx = 1\n\`\`\`\n`;
    await testDb.lesson.update({
      where: { id: fixture.lesson1Id },
      data: { contentMd, contentUpdatedAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    // Ровно то, что делает блочный редактор при открытии и автосейве без правок.
    const roundTripped = serialize(parse(contentMd));
    expect(roundTripped).toBe(contentMd);

    const before = await testDb.lesson.findUnique({ where: { id: fixture.lesson1Id } });
    const res = await saveLessonContent(testDb, {
      lessonId: fixture.lesson1Id,
      contentMd: roundTripped,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    const after = await testDb.lesson.findUnique({ where: { id: fixture.lesson1Id } });
    expect(after!.contentUpdatedAt.getTime()).toBe(before!.contentUpdatedAt.getTime());
    expect(await testDb.notification.count({ where: { type: "lesson_updated" } })).toBe(0);
  });
});

describe("края (2.3)", () => {
  it("вопрос удалён из банка: директива остаётся, ученик видит заглушку", async () => {
    const fixture = await makeInlineFixture();
    await testDb.question.delete({ where: { id: fixture.inlineId } });

    const map = await getInlineQuestionsForLesson(testDb, fixture.contentMd);
    const entry = map.get(fixture.inlineId);
    expect(entry?.question).toBeNull();
    expect(entry?.problem).toBe("missing");
  });

  it("вопрос и в тексте, и «в квизе» — внизу он не дублируется", async () => {
    const user = await makeStudent();
    const fixture = await makeInlineFixture();
    // Тот же вопрос дополнительно привязан ролью «в квизе».
    await testDb.questionLesson.create({
      data: { questionId: fixture.inlineId, lessonId: fixture.lesson1Id, inQuiz: true },
    });

    const quiz = await getQuizQuestionsForLesson(testDb, {
      lessonId: fixture.lesson1Id,
      userId: user.id,
      contentMd: fixture.contentMd,
    });
    expect(quiz.map((q) => q.id)).toEqual([fixture.quizId]);
  });

  it("XP за первый верный ответ начисляется один раз, где бы вопрос ни стоял", async () => {
    const user = await makeStudent();
    const fixture = await makeInlineFixture();
    await testDb.questionLesson.create({
      data: { questionId: fixture.inlineId, lessonId: fixture.lesson1Id, inQuiz: true },
    });

    const first = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inlineId,
      answer: CORRECT,
    });
    const second = await answerQuizQuestion(testDb, {
      userId: user.id,
      lessonId: fixture.lesson1Id,
      questionId: fixture.inlineId,
      answer: CORRECT,
    });
    expect(first.ok && first.first).toBe(true);
    expect(second.ok && second.first).toBe(false);

    const xp = await testDb.xpEvent.findMany({
      where: { userId: user.id, type: "quiz.correct_first", refId: fixture.inlineId },
    });
    expect(xp).toHaveLength(1);
  });
});
