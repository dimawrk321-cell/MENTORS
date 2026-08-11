import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb } from "./helpers/db";
import { getKeyQuestionsForLesson } from "@/lib/services/questions";
import { KeyQuestions } from "@/components/features/key-questions";
import type { Question } from "@prisma/client";

// Регресс на находку владельца: ментор привязал вопросы ролью «ключевой», а блок
// «Ключевые вопросы урока» у ученика не появился. Причина — вопрос-ЧЕРНОВИК:
// выборка отбрасывает неопубликованные (и правильно делает), а блок при пустом
// списке рендерит null, так что пропажа была молчаливой. Тесты фиксируют обе
// половины: что именно отдаёт сервис и когда блок вообще существует.

let categoryId = "";
let lessonId = "";
let otherLessonId = "";

async function makeQuestion(status: "draft" | "published", text: string, answerMd = "эталон") {
  return testDb.question.create({
    data: { type: "open", categoryId, textMd: text, answerMd, status, difficulty: 1 },
  });
}

beforeEach(async () => {
  await resetDb();
  categoryId = (
    await testDb.questionCategory.create({
      data: { title: "NLP", slug: "nlp", colorIndex: 0, order: 0 },
    })
  ).id;
  const course = await testDb.course.create({
    data: {
      slug: "course",
      title: "Курс",
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
                { slug: "l1", title: "Урок 1", order: 0, contentMd: "текст", status: "published" },
                { slug: "l2", title: "Урок 2", order: 1, contentMd: "текст", status: "published" },
              ],
            },
          },
        ],
      },
    },
    include: { modules: { include: { lessons: { orderBy: { order: "asc" } } } } },
  });
  const lessons = course.modules[0]!.lessons;
  lessonId = lessons[0]!.id;
  otherLessonId = lessons[1]!.id;
});

describe("getKeyQuestionsForLesson — что доезжает до ученика", () => {
  it("отдаёт опубликованные ключевые вопросы урока", async () => {
    const q1 = await makeQuestion("published", "Что такое attention?");
    const q2 = await makeQuestion("published", "Зачем нужен positional encoding?");
    await testDb.questionLesson.createMany({
      data: [
        { lessonId, questionId: q1.id, isKey: true, inQuiz: false },
        { lessonId, questionId: q2.id, isKey: true, inQuiz: false },
      ],
    });
    const keys = await getKeyQuestionsForLesson(testDb, lessonId);
    expect(keys.map((k) => k.id).sort()).toEqual([q1.id, q2.id].sort());
  });

  it("ЧЕРНОВИК, привязанный ключевым, до ученика не доезжает", async () => {
    // Ровно случай владельца: в редакторе счётчик показывает привязку, а блока нет.
    const draft = await makeQuestion("draft", "Черновик");
    await testDb.questionLesson.create({
      data: { lessonId, questionId: draft.id, isKey: true, inQuiz: false },
    });
    expect(await getKeyQuestionsForLesson(testDb, lessonId)).toEqual([]);
  });

  it("опубликованный ключевой с эталоном рендерится под уроком", async () => {
    // Прямая проверка цепочки блока 3: роль «ключевой» + published + непустой
    // эталон = блок под уроком существует и содержит этот вопрос.
    const q = await makeQuestion("published", "Что такое attention?");
    await testDb.questionLesson.create({
      data: { lessonId, questionId: q.id, isKey: true, inQuiz: false },
    });
    const keys = await getKeyQuestionsForLesson(testDb, lessonId);
    expect(keys.map((k) => k.id)).toEqual([q.id]);
    expect(KeyQuestions({ questions: keys })).not.toBeNull();
  });

  it("ПУСТОЙ ЭТАЛОН у ключевого вопроса — до ученика не доезжает", async () => {
    // Вторая молчаливая причина пропажи блока (заход «Доступ к вопросам»):
    // опубликован, роль стоит, а обратной стороны у карточки нет.
    const blank = await makeQuestion("published", "Без эталона", "   ");
    await testDb.questionLesson.create({
      data: { lessonId, questionId: blank.id, isKey: true, inQuiz: false },
    });
    expect(await getKeyQuestionsForLesson(testDb, lessonId)).toEqual([]);
  });

  it("не ключевые роли в блок не попадают", async () => {
    const inQuiz = await makeQuestion("published", "В квизе");
    const plain = await makeQuestion("published", "Просто привязан");
    await testDb.questionLesson.createMany({
      data: [
        { lessonId, questionId: inQuiz.id, isKey: false, inQuiz: true },
        { lessonId, questionId: plain.id, isKey: false, inQuiz: false },
      ],
    });
    expect(await getKeyQuestionsForLesson(testDb, lessonId)).toEqual([]);
  });

  it("не берёт ключевые вопросы соседнего урока", async () => {
    const q = await makeQuestion("published", "Чужой ключевой");
    await testDb.questionLesson.create({
      data: { lessonId: otherLessonId, questionId: q.id, isKey: true, inQuiz: false },
    });
    expect(await getKeyQuestionsForLesson(testDb, lessonId)).toEqual([]);
  });
});

describe("KeyQuestions — блок есть ровно тогда, когда есть вопросы", () => {
  const fake = (id: string) => ({ id, textMd: "Вопрос?" }) as unknown as Question;

  it("урок с ключевыми вопросами рендерит блок", () => {
    expect(KeyQuestions({ questions: [fake("q1")] })).not.toBeNull();
  });

  it("без ключевых вопросов блок не рендерится", () => {
    expect(KeyQuestions({ questions: [] })).toBeNull();
  });
});
