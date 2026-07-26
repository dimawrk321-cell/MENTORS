import { describe, it, expect, beforeEach } from "vitest";
import type { ContentStatus, QuestionType } from "@prisma/client";
import { testDb, resetDb } from "./helpers/db";
import { listQuestionsCatalogGrouped } from "@/lib/services/questions";

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
