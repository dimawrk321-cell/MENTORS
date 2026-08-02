import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import {
  setQuestionStatus,
  updateQuestion,
  validateQuestionForPublish,
} from "@/lib/services/questions";

// Регресс на находку владельца: открытый вопрос с введённым эталоном не
// публиковался — тост «У открытого вопроса нет эталонного ответа». Валидатор
// читает СОХРАНЁННОЕ значение (и правильно), а эталон жил только в форме:
// предпросмотр рисует состояние формы, поэтому правка выглядела сохранённой.
// Здесь закреплён серверный контракт: сохранили эталон → публикуется.

let categoryId = "";
let actorId = "";

async function makeOpenQuestion(answerMd: string | null) {
  return testDb.question.create({
    data: {
      type: "open",
      categoryId,
      textMd: "Почему список нельзя использовать как ключ словаря?",
      answerMd,
      status: "draft",
      difficulty: 1,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  categoryId = (
    await testDb.questionCategory.create({
      data: { title: "Python", slug: "python", colorIndex: 0, order: 0 },
    })
  ).id;
  actorId = (
    await createTestUser({ email: "mentor@test.local", passwordHash: "unused", role: "mentor" })
  ).id;
});

describe("validateQuestionForPublish — открытый вопрос", () => {
  const base = { type: "open" as const, textMd: "Вопрос?", options: null, acceptedAnswers: null };

  it("непустой эталон — претензий нет", () => {
    expect(validateQuestionForPublish({ ...base, answerMd: "Список изменяем." })).toEqual([]);
  });

  it("пустой эталон — претензия", () => {
    expect(validateQuestionForPublish({ ...base, answerMd: "" })).toContain(
      "У открытого вопроса нет эталонного ответа",
    );
    expect(validateQuestionForPublish({ ...base, answerMd: null })).toContain(
      "У открытого вопроса нет эталонного ответа",
    );
  });

  it("пробелы и переносы за ответ не считаются", () => {
    expect(validateQuestionForPublish({ ...base, answerMd: "   \n\n\t " })).toContain(
      "У открытого вопроса нет эталонного ответа",
    );
  });

  it("эталон, обёрнутый пробелами и переносами, — валиден", () => {
    expect(validateQuestionForPublish({ ...base, answerMd: "\n\n  Список изменяем.  \n" })).toEqual(
      [],
    );
  });
});

describe("setQuestionStatus — публикация открытого вопроса", () => {
  it("открытый вопрос с непустым эталоном публикуется", async () => {
    const q = await makeOpenQuestion("Список изменяем, поэтому не хешируется.");
    const res = await setQuestionStatus(testDb, {
      actorId,
      questionId: q.id,
      status: "published",
    });
    expect(res.ok).toBe(true);
    const after = await testDb.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.status).toBe("published");
  });

  it("без эталона публикация отклоняется с человеческой причиной", async () => {
    const q = await makeOpenQuestion(null);
    const res = await setQuestionStatus(testDb, {
      actorId,
      questionId: q.id,
      status: "published",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("invalid");
      expect(res.problems).toContain("У открытого вопроса нет эталонного ответа");
    }
  });

  it("сохранение эталона снимает отказ — тот самый сценарий владельца", async () => {
    const q = await makeOpenQuestion(null);
    const before = await setQuestionStatus(testDb, {
      actorId,
      questionId: q.id,
      status: "published",
    });
    expect(before.ok).toBe(false);

    // «Опубликовать» теперь сначала сохраняет форму — воспроизводим этот порядок.
    const saved = await updateQuestion(testDb, {
      actorId,
      questionId: q.id,
      data: {
        categoryId,
        textMd: q.textMd,
        answerMd: "Список изменяем, поэтому не хешируется.",
        explanationMd: null,
        options: null,
        acceptedAnswers: null,
        difficulty: 1,
        needsLatex: false,
      },
    });
    expect(saved.ok).toBe(true);

    const after = await setQuestionStatus(testDb, {
      actorId,
      questionId: q.id,
      status: "published",
    });
    expect(after.ok).toBe(true);
    expect((await testDb.question.findUniqueOrThrow({ where: { id: q.id } })).status).toBe(
      "published",
    );
  });
});
