import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { computeCourseCategoryPrefill, getQuestionAccess } from "@/lib/services/question-access";
import { listQuestionsCatalogGrouped } from "@/lib/services/questions";

// Заход «Банк вопросов», блок A: доступ к вопросам подчиняется цепи курсов через
// связь «курс ↔ категории». Категория без курса — общий пул, видна всем;
// категория запертого курса не видна вовсе (не замком — её просто нет).

let studentId = "";
let openCourseId = "";
let lockedCourseId = "";
let openCategoryId = "";
let lockedCategoryId = "";
let sharedCategoryId = "";
let subOfLockedId = "";

/**
 * Курс с одним обязательным уроком. Урок обязателен: курс БЕЗ обязательных
 * уроков — сквозное звено цепи («пустое звено открывается, но не держит цепь»,
 * changelog 13.6), и тогда открытыми оказались бы оба курса разом.
 */
async function makeCourse(slug: string, title: string, order: number) {
  return testDb.course.create({
    data: {
      slug,
      title,
      order,
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
                {
                  slug: `${slug}-l1`,
                  title: "Урок",
                  order: 0,
                  contentMd: "текст",
                  status: "published",
                },
              ],
            },
          },
        ],
      },
    },
  });
}

async function makeCategory(slug: string, title: string, parentId?: string) {
  return testDb.questionCategory.create({
    data: { slug, title, colorIndex: 0, order: 0, parentId: parentId ?? null },
  });
}

async function makeQuestion(categoryId: string, textMd: string) {
  return testDb.question.create({
    data: {
      type: "open",
      categoryId,
      textMd,
      answerMd: "эталон",
      status: "published",
      difficulty: 1,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  const student = await createTestUser({
    email: "student@test.local",
    passwordHash: "unused",
    activatedAt: new Date("2026-07-01T00:00:00.000Z"),
    accessUntil: new Date("2027-07-01T00:00:00.000Z"),
  });
  studentId = student.id;

  openCourseId = (await makeCourse("open", "Открытый курс", 0)).id;
  lockedCourseId = (await makeCourse("locked", "Запертый курс", 1)).id;

  openCategoryId = (await makeCategory("open-cat", "Категория открытого")).id;
  lockedCategoryId = (await makeCategory("locked-cat", "Категория запертого")).id;
  subOfLockedId = (await makeCategory("locked-sub", "Подкатегория", lockedCategoryId)).id;
  sharedCategoryId = (await makeCategory("shared-cat", "Общий пул")).id;

  await testDb.courseQuestionCategory.createMany({
    data: [
      { courseId: openCourseId, categoryId: openCategoryId },
      { courseId: lockedCourseId, categoryId: lockedCategoryId },
    ],
  });

  // Первый курс цепи открыт всем без строки доступа; второй заперт.
  await makeQuestion(openCategoryId, "Вопрос открытого курса");
  await makeQuestion(lockedCategoryId, "Вопрос запертого курса");
  await makeQuestion(subOfLockedId, "Вопрос подкатегории запертого");
  await makeQuestion(sharedCategoryId, "Вопрос общего пула");
});

describe("getQuestionAccess — категории следуют за цепью курсов", () => {
  it("категория открытого курса видна", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(openCategoryId)).toBe(true);
  });

  it("категория запертого курса не видна", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(lockedCategoryId)).toBe(false);
  });

  it("подкатегория наследует запрет от родителя", async () => {
    // Ментор связывает курс с корнем, вопросы лежат в подкатегориях — без
    // наследования связь прятала бы ровно то, ради чего её заводили.
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(subOfLockedId)).toBe(false);
  });

  it("категория без курса — общий пул, видна всем", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.sharedCategoryIds.has(sharedCategoryId)).toBe(true);
    expect(access.categoryIds.has(sharedCategoryId)).toBe(true);
  });

  it("открытие курса возвращает его категорию", async () => {
    await testDb.courseAccess.create({
      data: {
        userId: studentId,
        courseId: lockedCourseId,
        unlockedAt: new Date(),
        unlockedBy: "admin",
      },
    });
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(lockedCategoryId)).toBe(true);
    expect(access.categoryIds.has(subOfLockedId)).toBe(true);
  });
});

describe("каталог /questions фильтруется тем же доступом", () => {
  it("вопросы запертых категорий в каталог не попадают", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    const { groups } = await listQuestionsCatalogGrouped(testDb, {
      allowedCategoryIds: [...access.categoryIds],
    });
    const texts = groups.flatMap((g) => g.questions.map((q) => q.teaser));
    expect(texts.join(" ")).toContain("Вопрос открытого курса");
    expect(texts.join(" ")).toContain("Вопрос общего пула");
    expect(texts.join(" ")).not.toContain("Вопрос запертого курса");
    expect(texts.join(" ")).not.toContain("Вопрос подкатегории запертого");
  });

  it("пустой список доступа — честный ноль, а не «показать всё»", async () => {
    const { groups, total } = await listQuestionsCatalogGrouped(testDb, {
      allowedCategoryIds: [],
    });
    expect(total).toBe(0);
    expect(groups).toEqual([]);
  });

  it("выбор категории не открывает то, что цепь закрыла", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    const { total } = await listQuestionsCatalogGrouped(testDb, {
      categoryId: lockedCategoryId,
      allowedCategoryIds: [...access.categoryIds],
    });
    expect(total).toBe(0);
  });
});

describe("предзаполнение связи по существующим привязкам вопрос→урок", () => {
  it("категория относится к курсу, если её вопросы привязаны к его урокам", async () => {
    const course = await testDb.course.create({
      data: {
        slug: "prefill",
        title: "Курс с уроками",
        order: 2,
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
                  { slug: "l1", title: "Урок", order: 0, contentMd: "текст", status: "published" },
                ],
              },
            },
          ],
        },
      },
      include: { modules: { include: { lessons: true } } },
    });
    const lessonId = course.modules[0]!.lessons[0]!.id;
    const q1 = await makeQuestion(sharedCategoryId, "Привязанный 1");
    const q2 = await makeQuestion(sharedCategoryId, "Привязанный 2");
    await testDb.questionLesson.createMany({
      data: [
        { lessonId, questionId: q1.id, isKey: false, inQuiz: false },
        { lessonId, questionId: q2.id, isKey: false, inQuiz: false },
      ],
    });

    const rows = await computeCourseCategoryPrefill(testDb);
    const row = rows.find((r) => r.courseId === course.id && r.categoryId === sharedCategoryId);
    expect(row).toBeDefined();
    expect(row!.questions).toBe(2);
  });

  it("курс без привязанных вопросов в предзаполнение не попадает", async () => {
    const rows = await computeCourseCategoryPrefill(testDb);
    expect(rows.some((r) => r.courseId === openCourseId)).toBe(false);
  });
});
