import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import {
  linkCategoryToLesson,
  suggestLessonCategories,
} from "@/lib/services/lesson-category-match";
import { bulkSetQuestionLinkRole } from "@/lib/services/questions";

// Block 3v2: linking questions to lessons BY CATEGORY. The hint-based pass is
// exhausted, so this one matches names — and a name match is a proposal, which
// is why the script only ever writes what a reviewer ticked.

async function seed() {
  const course = await testDb.course.create({
    data: { slug: "python", title: "Python + PyTorch", order: 0, status: "published" },
  });
  const mod = await testDb.module.create({
    data: { courseId: course.id, title: "Основной", order: 0, status: "published" },
  });
  const lesson = async (slug: string, title: string, order: number) =>
    testDb.lesson.create({
      data: { moduleId: mod.id, slug, title, order, status: "published", contentMd: "т" },
    });

  const root = await testDb.questionCategory.create({
    data: { title: "Python", slug: "python-cat", colorIndex: 0, order: 0 },
  });
  const category = async (title: string, slug: string) =>
    testDb.questionCategory.create({
      data: { title, slug, colorIndex: 0, order: 0, parentId: root.id },
    });

  return { course, mod, lesson, root, category };
}

async function addQuestions(
  categoryId: string,
  count: number,
  status: "published" | "draft" = "published",
) {
  const made = [];
  for (let i = 0; i < count; i += 1) {
    made.push(
      await testDb.question.create({
        data: {
          type: "open",
          categoryId,
          textMd: `Вопрос ${categoryId}-${i}`,
          answerMd: "Ответ",
          status,
          difficulty: 1,
        },
      }),
    );
  }
  return made;
}

describe("category suggestions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("matches when every meaningful word of the category is in the lesson title", async () => {
    const s = await seed();
    const cat = await s.category("Подводные камни", "podvodnye-kamni");
    await addQuestions(cat.id, 2);
    await s.lesson("fn", "Функции, области видимости, подводные камни", 0);

    const [row] = await suggestLessonCategories(testDb as never);
    const hit = row!.suggestions.find((x) => x.categoryTitle === "Подводные камни")!;
    expect(hit.confidence).toBe("высокая");
    expect(hit.questionCount).toBe(2);
    expect(hit.because).toContain("подводн");
  });

  it("offers several categories for a lesson that covers several topics", async () => {
    const s = await seed();
    const lists = await s.category("Списки и кортежи", "spiski");
    const dicts = await s.category("Словари", "slovari");
    await addQuestions(lists.id, 4);
    await addQuestions(dicts.id, 5);
    await s.lesson("coll", "Коллекции: списки, кортежи, словари", 0);

    const [row] = await suggestLessonCategories(testDb as never);
    const titles = row!.suggestions.map((x) => x.categoryTitle);
    expect(titles).toContain("Списки и кортежи");
    expect(titles).toContain("Словари");
  });

  it("counts only PUBLISHED questions, and reports what is already linked", async () => {
    const s = await seed();
    const cat = await s.category("Декораторы", "dekoratory");
    const published = await addQuestions(cat.id, 3);
    await addQuestions(cat.id, 2, "draft");
    const lesson = await s.lesson("dec", "Декораторы", 0);
    await testDb.questionLesson.create({
      data: { questionId: published[0]!.id, lessonId: lesson.id },
    });

    const [row] = await suggestLessonCategories(testDb as never);
    const hit = row!.suggestions.find((x) => x.categoryTitle === "Декораторы")!;
    expect(hit.questionCount).toBe(3);
    expect(hit.alreadyLinked).toBe(1);
  });

  it("does not match on structural words alone", async () => {
    const s = await seed();
    const cat = await s.category("Основы статистики", "osnovy-stat");
    await addQuestions(cat.id, 2);
    // «Введение» and «основы» are stopwords — this lesson must NOT match.
    await s.lesson("intro", "Введение в курс", 0);

    const [row] = await suggestLessonCategories(testDb as never);
    expect(row!.suggestions.map((x) => x.categoryTitle)).not.toContain("Основы статистики");
  });

  it("writes nothing — suggesting is read-only", async () => {
    const s = await seed();
    const cat = await s.category("Словари", "slovari");
    await addQuestions(cat.id, 3);
    await s.lesson("d", "Словари", 0);

    await suggestLessonCategories(testDb as never);
    expect(await testDb.questionLesson.count()).toBe(0);
  });
});

describe("applying a category link", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("links published questions with the role «просто привязан»", async () => {
    const s = await seed();
    const cat = await s.category("Словари", "slovari");
    await addQuestions(cat.id, 3);
    await addQuestions(cat.id, 1, "draft");
    const lesson = await s.lesson("d", "Словари", 0);

    const res = await linkCategoryToLesson(testDb as never, {
      lessonId: lesson.id,
      categoryId: cat.id,
      commit: true,
    });
    expect(res.created).toBe(3);
    const links = await testDb.questionLesson.findMany({ where: { lessonId: lesson.id } });
    expect(links).toHaveLength(3);
    expect(links.every((l) => !l.isKey && !l.inQuiz)).toBe(true);
  });

  it("is idempotent and never demotes an existing role", async () => {
    const s = await seed();
    const cat = await s.category("Словари", "slovari");
    const questions = await addQuestions(cat.id, 3);
    const lesson = await s.lesson("d", "Словари", 0);
    // One question is already a KEY question — a bulk pass must not undo that.
    await testDb.questionLesson.create({
      data: { questionId: questions[0]!.id, lessonId: lesson.id, isKey: true },
    });

    const first = await linkCategoryToLesson(testDb as never, {
      lessonId: lesson.id,
      categoryId: cat.id,
      commit: true,
    });
    expect(first).toEqual({ created: 2, existing: 1 });

    const second = await linkCategoryToLesson(testDb as never, {
      lessonId: lesson.id,
      categoryId: cat.id,
      commit: true,
    });
    expect(second.created).toBe(0);

    const key = await testDb.questionLesson.findFirstOrThrow({
      where: { lessonId: lesson.id, questionId: questions[0]!.id },
    });
    expect(key.isKey).toBe(true);
  });

  it("a dry run writes nothing but reports the same number", async () => {
    const s = await seed();
    const cat = await s.category("Словари", "slovari");
    await addQuestions(cat.id, 3);
    const lesson = await s.lesson("d", "Словари", 0);

    const preview = await linkCategoryToLesson(testDb as never, {
      lessonId: lesson.id,
      categoryId: cat.id,
      commit: false,
    });
    expect(preview.created).toBe(3);
    expect(await testDb.questionLesson.count()).toBe(0);

    const applied = await linkCategoryToLesson(testDb as never, {
      lessonId: lesson.id,
      categoryId: cat.id,
      commit: true,
    });
    expect(applied.created).toBe(preview.created);
  });
});

describe("bulk role marking", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks a selection «ключевой» and keeps the roles mutually exclusive", async () => {
    const s = await seed();
    const cat = await s.category("Словари", "slovari");
    const questions = await addQuestions(cat.id, 3);
    const lesson = await s.lesson("d", "Словари", 0);
    const admin = await createTestUser({ email: "bulk-role@test.local", role: "owner" });
    await linkCategoryToLesson(testDb as never, {
      lessonId: lesson.id,
      categoryId: cat.id,
      commit: true,
    });
    // Put one in the quiz first, to prove the roles do not stack.
    await testDb.questionLesson.updateMany({
      where: { lessonId: lesson.id, questionId: questions[0]!.id },
      data: { inQuiz: true },
    });

    const res = await bulkSetQuestionLinkRole(testDb as never, {
      actorId: admin.id,
      lessonId: lesson.id,
      questionIds: [questions[0]!.id, questions[1]!.id],
      role: "key",
    });
    expect(res.updated).toBe(2);

    const links = await testDb.questionLesson.findMany({ where: { lessonId: lesson.id } });
    const marked = links.filter((l) => l.isKey);
    expect(marked).toHaveLength(2);
    expect(marked.every((l) => !l.inQuiz)).toBe(true);
    // The unselected one is untouched.
    expect(links.find((l) => l.questionId === questions[2]!.id)!.isKey).toBe(false);
  });

  it("writes one audit entry for the batch, not one per question", async () => {
    const s = await seed();
    const cat = await s.category("Словари", "slovari");
    const questions = await addQuestions(cat.id, 3);
    const lesson = await s.lesson("d", "Словари", 0);
    const admin = await createTestUser({ email: "bulk-audit@test.local", role: "owner" });
    await linkCategoryToLesson(testDb as never, {
      lessonId: lesson.id,
      categoryId: cat.id,
      commit: true,
    });

    await bulkSetQuestionLinkRole(testDb as never, {
      actorId: admin.id,
      lessonId: lesson.id,
      questionIds: questions.map((q) => q.id),
      role: "key",
    });
    const audit = await testDb.auditLog.findMany({
      where: { action: "question.links_bulk_role" },
    });
    expect(audit).toHaveLength(1);
  });
});
