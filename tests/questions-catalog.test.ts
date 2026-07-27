import { describe, it, expect, beforeEach } from "vitest";
import { Prisma, type ContentStatus, type QuestionType } from "@prisma/client";
import { testDb, resetDb } from "./helpers/db";
import { listQuestionsCatalogGrouped, renderCatalogAnswer } from "@/lib/services/questions";
import { catalogTeaser } from "@/lib/utils/text";

// Walk 13.5 block 1: grouped catalog — published questions grouped under their ROOT
// category in category order; a subcategory's questions fold into the parent section;
// filters (type/difficulty/ids) narrow the set; drafts are excluded.

let root0 = "";
let root1 = "";
let sub0 = "";

async function seedCategories() {
  root0 = (
    await testDb.questionCategory.create({
      data: { title: "Classic ML", slug: "classic-ml", colorIndex: 0, order: 0 },
    })
  ).id;
  root1 = (
    await testDb.questionCategory.create({
      data: { title: "Python", slug: "python", colorIndex: 1, order: 1 },
    })
  ).id;
  sub0 = (
    await testDb.questionCategory.create({
      data: { title: "Метрики", slug: "metrics", colorIndex: 0, order: 0, parentId: root0 },
    })
  ).id;
}

let seq = 0;
async function makeQuestion(input: {
  categoryId: string;
  status?: ContentStatus;
  type?: QuestionType;
  difficulty?: number;
  text?: string;
}) {
  seq += 1;
  return testDb.question.create({
    data: {
      type: input.type ?? "open",
      categoryId: input.categoryId,
      textMd: input.text ?? `Вопрос ${seq}?`,
      answerMd: "эталон",
      status: input.status ?? "published",
      difficulty: input.difficulty ?? 1,
    },
  });
}

describe("listQuestionsCatalogGrouped (walk 13.5 block 1)", () => {
  beforeEach(async () => {
    await resetDb();
    root0 = root1 = sub0 = "";
    seq = 0;
    await seedCategories();
  });

  it("группирует по корневой категории (подкатегория сворачивается в родителя) в порядке order", async () => {
    await makeQuestion({ categoryId: root0 }); // Classic ML
    await makeQuestion({ categoryId: sub0 }); // Метрики → сворачивается в Classic ML
    await makeQuestion({ categoryId: root1 }); // Python
    await makeQuestion({ categoryId: root0, status: "draft" }); // черновик — исключён

    const { groups, total } = await listQuestionsCatalogGrouped(testDb, {});
    expect(total).toBe(3);
    expect(groups.map((g) => g.title)).toEqual(["Classic ML", "Python"]);
    // Секция Classic ML содержит и корневой вопрос, и вопрос подкатегории.
    expect(groups[0]!.questions).toHaveLength(2);
    expect(groups[0]!.colorIndex).toBe(0);
    expect(groups[1]!.questions).toHaveLength(1);
    expect(groups[1]!.title).toBe("Python");
  });

  it("пустые категории не образуют секций", async () => {
    await makeQuestion({ categoryId: root1 });
    const { groups } = await listQuestionsCatalogGrouped(testDb, {});
    expect(groups.map((g) => g.title)).toEqual(["Python"]);
  });

  it("фильтр по сложности и типу сужает выборку", async () => {
    await makeQuestion({ categoryId: root0, difficulty: 1, type: "open" });
    await makeQuestion({ categoryId: root0, difficulty: 3, type: "single" });

    const byDifficulty = await listQuestionsCatalogGrouped(testDb, { difficulty: 3 });
    expect(byDifficulty.total).toBe(1);
    expect(byDifficulty.groups[0]!.questions[0]!.difficulty).toBe(3);

    const byType = await listQuestionsCatalogGrouped(testDb, { type: "single" });
    expect(byType.total).toBe(1);
    expect(byType.groups[0]!.questions[0]!.type).toBe("single");
  });

  it("ids (мои западающие) ограничивает выборку", async () => {
    const keep = await makeQuestion({ categoryId: root0 });
    await makeQuestion({ categoryId: root0 });
    const res = await listQuestionsCatalogGrouped(testDb, { ids: [keep.id] });
    expect(res.total).toBe(1);
    expect(res.groups[0]!.questions[0]!.id).toBe(keep.id);
  });

  it("строки несут teaser + isShort (эталон не грузится здесь)", async () => {
    await makeQuestion({ categoryId: root0, text: "Что такое точность?" }); // короткий
    const longText =
      "Опиши подробно, как устроен механизм внимания в трансформерах и зачем нужны несколько голов внимания";
    await makeQuestion({ categoryId: root0, text: longText }); // длинный
    const { groups } = await listQuestionsCatalogGrouped(testDb, {});
    const rows = groups[0]!.questions;
    const short = rows.find((r) => r.teaser === "Что такое точность?");
    const long = rows.find((r) => !r.isShort);
    expect(short?.isShort).toBe(true);
    expect(long).toBeTruthy();
    expect(long!.teaser.endsWith("…")).toBe(true);
    // Payload не содержит эталон — только to-be-loaded поля.
    expect(Object.keys(rows[0]!)).toEqual(
      expect.arrayContaining(["id", "teaser", "isShort", "type", "difficulty", "lessonId"]),
    );
    expect(rows[0]).not.toHaveProperty("answerMd");
  });

  it("lessonId — только опубликованный привязанный урок", async () => {
    const q = await makeQuestion({ categoryId: root0 });
    // Урок в черновике курса/модуля не должен подставляться как «Открыть урок».
    const course = await testDb.course.create({
      data: { slug: "c1", title: "C1", order: 0, gating: "free", status: "published" },
    });
    const mod = await testDb.module.create({
      data: { courseId: course.id, title: "M1", order: 0, status: "published" },
    });
    const lesson = await testDb.lesson.create({
      data: {
        moduleId: mod.id,
        slug: "l1",
        title: "L1",
        order: 0,
        status: "published",
        contentMd: "x",
        difficulty: "base",
      },
    });
    await testDb.questionLesson.create({
      data: { questionId: q.id, lessonId: lesson.id, isKey: false, inQuiz: false },
    });

    const res = await listQuestionsCatalogGrouped(testDb, {});
    expect(res.groups[0]!.questions[0]!.lessonId).toBe(lesson.id);
  });
});

describe("catalogTeaser (walk 13.5 lazy)", () => {
  it("короткий текст → isShort, teaser = полный текст без «…»", () => {
    const r = catalogTeaser("Что такое переобучение?");
    expect(r.isShort).toBe(true);
    expect(r.teaser).toBe("Что такое переобучение?");
  });

  it("длинный текст → обрезка по границе слова с «…»", () => {
    const long =
      "Расскажи, как работает алгоритм обратного распространения ошибки и почему он эффективен на практике";
    const r = catalogTeaser(long);
    expect(r.isShort).toBe(false);
    expect(r.teaser.endsWith("…")).toBe(true);
    expect(r.teaser.length).toBeLessThanOrEqual(82);
    expect(long.startsWith(r.teaser.replace(/…$/, "").trimEnd())).toBe(true);
  });

  it("пустой текст → «Без текста»", () => {
    expect(catalogTeaser("").teaser).toBe("Без текста");
  });
});

describe("renderCatalogAnswer — ленивый рендер эталона (walk 13.5)", () => {
  let catId = "";
  beforeEach(async () => {
    await resetDb();
    catId = (
      await testDb.questionCategory.create({
        data: { title: "Cat", slug: "cat", colorIndex: 0, order: 0 },
      })
    ).id;
  });

  it("open + answer_md → answerHtml с рендером; короткий → questionHtml=null", async () => {
    const q = await testDb.question.create({
      data: {
        type: "open",
        categoryId: catId,
        textMd: "Что такое F1?",
        answerMd: "Это **среднее гармоническое** precision и recall.",
        status: "published",
        difficulty: 1,
      },
    });
    const res = await renderCatalogAnswer(testDb, q.id);
    expect(res).not.toBeNull();
    expect(res!.questionHtml).toBeNull(); // короткий вопрос — текст уже в строке
    expect(res!.answerHtml).toContain("среднее гармоническое");
    expect(res!.answerHtml).toContain("<strong>");
  });

  it("длинный open → questionHtml с полным текстом вопроса", async () => {
    const longText =
      "Опиши подробно, как устроен механизм внимания в трансформерах и зачем нужно несколько голов внимания в модели";
    const q = await testDb.question.create({
      data: {
        type: "open",
        categoryId: catId,
        textMd: longText,
        answerMd: "Ответ.",
        status: "published",
        difficulty: 2,
      },
    });
    const res = await renderCatalogAnswer(testDb, q.id);
    expect(res!.questionHtml).toBeTruthy();
    expect(res!.questionHtml).toContain("механизм внимания");
  });

  it("KaTeX-разметка ($…$) рендерится в answerHtml", async () => {
    const q = await testDb.question.create({
      data: {
        type: "open",
        categoryId: catId,
        textMd: "Формула?",
        answerMd: "Ответ: $x^2 + y^2$.",
        status: "published",
        difficulty: 1,
      },
    });
    const res = await renderCatalogAnswer(testDb, q.id);
    expect(res!.answerHtml).toContain("katex");
  });

  it("закрытый (single) без answer_md → правильный вариант + разбор", async () => {
    const q = await testDb.question.create({
      data: {
        type: "single",
        categoryId: catId,
        textMd: "Выбери верное",
        answerMd: null,
        explanationMd: "Потому что так.",
        options: [
          { id: "a", text: "Правильный вариант", correct: true },
          { id: "b", text: "Неправильный", correct: false },
        ] as Prisma.InputJsonValue,
        status: "published",
        difficulty: 1,
      },
    });
    const res = await renderCatalogAnswer(testDb, q.id);
    expect(res!.answerHtml).toContain("Правильный ответ");
    expect(res!.answerHtml).toContain("Правильный вариант");
    expect(res!.answerHtml).toContain("Потому что так");
  });

  it("черновик / несуществующий → null", async () => {
    const draft = await testDb.question.create({
      data: {
        type: "open",
        categoryId: catId,
        textMd: "x",
        answerMd: "y",
        status: "draft",
        difficulty: 1,
      },
    });
    expect(await renderCatalogAnswer(testDb, draft.id)).toBeNull();
    expect(await renderCatalogAnswer(testDb, "nope")).toBeNull();
  });
});
