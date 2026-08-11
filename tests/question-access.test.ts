import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { computeCourseCategoryPrefill, getQuestionAccess } from "@/lib/services/question-access";
import { listQuestionsCatalogGrouped } from "@/lib/services/questions";
import { buildFreeTrainingSet, listFreeTrainingSources } from "@/lib/services/free-training";
import { getSrsQueue } from "@/lib/services/srs";

// Заход «Банк вопросов», блок A + заход «Доступ к вопросам», блок 2: доступ к
// банку двухуровневый.
//   • курс ПРОЙДЕН        → вся его категория (с поддеревом);
//   • курс В ПРОЦЕССЕ     → только ключевые вопросы ПРОЙДЕННЫХ уроков;
//   • курс ЗАПЕРТ         → ничего;
//   • категория без курса → общий пул, видна всем.
// Плюс блок 1: вопрос без эталона не попадает никуда — ни в каталог, ни в набор
// свободной тренировки, ни в очередь SRS.

let studentId = "";
let doneCourseId = "";
let activeCourseId = "";
let lockedCourseId = "";
let doneCategoryId = "";
let activeCategoryId = "";
let activeSubId = "";
let lockedCategoryId = "";
let lockedSubId = "";
let sharedCategoryId = "";

let doneLessonId = "";
let activeDoneLessonId = "";
let activePendingLessonId = "";

let qDoneId = "";
let qActiveKeyDoneId = "";
let qActiveKeyPendingId = "";
let qActivePlainId = "";
let qLockedId = "";
let qSharedId = "";
let qNoAnswerId = "";

/**
 * Курс с обязательными уроками. Урок обязателен: курс БЕЗ обязательных уроков —
 * сквозное звено цепи («пустое звено открывается, но не держит цепь»,
 * changelog 13.6), и тогда открытыми оказались бы все курсы разом.
 */
async function makeCourse(slug: string, title: string, order: number, lessons: number) {
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
              create: Array.from({ length: lessons }, (_, index) => ({
                slug: `${slug}-l${index + 1}`,
                title: `Урок ${index + 1}`,
                order: index,
                contentMd: "текст",
                status: "published" as const,
              })),
            },
          },
        ],
      },
    },
    include: { modules: { include: { lessons: { orderBy: { order: "asc" } } } } },
  });
}

async function makeCategory(slug: string, title: string, parentId?: string) {
  return testDb.questionCategory.create({
    data: { slug, title, colorIndex: 0, order: 0, parentId: parentId ?? null },
  });
}

async function makeQuestion(
  categoryId: string,
  textMd: string,
  answerMd: string | null = "эталон",
) {
  return testDb.question.create({
    data: { type: "open", categoryId, textMd, answerMd, status: "published", difficulty: 1 },
  });
}

async function completeLesson(lessonId: string) {
  await testDb.lessonProgress.create({
    data: { userId: studentId, lessonId, status: "completed", completedAt: new Date() },
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

  const done = await makeCourse("done", "Пройденный курс", 0, 1);
  const active = await makeCourse("active", "Курс в процессе", 1, 2);
  const locked = await makeCourse("locked", "Запертый курс", 2, 1);
  doneCourseId = done.id;
  activeCourseId = active.id;
  lockedCourseId = locked.id;
  doneLessonId = done.modules[0]!.lessons[0]!.id;
  activeDoneLessonId = active.modules[0]!.lessons[0]!.id;
  activePendingLessonId = active.modules[0]!.lessons[1]!.id;

  doneCategoryId = (await makeCategory("done-cat", "Категория пройденного")).id;
  activeCategoryId = (await makeCategory("active-cat", "Категория текущего")).id;
  activeSubId = (await makeCategory("active-sub", "Подкатегория текущего", activeCategoryId)).id;
  lockedCategoryId = (await makeCategory("locked-cat", "Категория запертого")).id;
  lockedSubId = (await makeCategory("locked-sub", "Подкатегория запертого", lockedCategoryId)).id;
  sharedCategoryId = (await makeCategory("shared-cat", "Общий пул")).id;

  await testDb.courseQuestionCategory.createMany({
    data: [
      { courseId: doneCourseId, categoryId: doneCategoryId },
      { courseId: activeCourseId, categoryId: activeCategoryId },
      { courseId: lockedCourseId, categoryId: lockedCategoryId },
    ],
  });

  qDoneId = (await makeQuestion(doneCategoryId, "Вопрос пройденного курса")).id;
  qActiveKeyDoneId = (await makeQuestion(activeCategoryId, "Ключевой пройденного урока")).id;
  qActiveKeyPendingId = (await makeQuestion(activeCategoryId, "Ключевой непройденного урока")).id;
  qActivePlainId = (await makeQuestion(activeSubId, "Просто привязанный")).id;
  qLockedId = (await makeQuestion(lockedCategoryId, "Вопрос запертого курса")).id;
  qSharedId = (await makeQuestion(sharedCategoryId, "Вопрос общего пула")).id;
  qNoAnswerId = (await makeQuestion(sharedCategoryId, "Вопрос без эталона", "   ")).id;
  await makeQuestion(lockedSubId, "Вопрос подкатегории запертого");

  await testDb.questionLesson.createMany({
    data: [
      { lessonId: activeDoneLessonId, questionId: qActiveKeyDoneId, isKey: true, inQuiz: false },
      {
        lessonId: activePendingLessonId,
        questionId: qActiveKeyPendingId,
        isKey: true,
        inQuiz: false,
      },
      { lessonId: activeDoneLessonId, questionId: qActivePlainId, isKey: false, inQuiz: false },
    ],
  });

  // Первый курс цепи открыт без строки доступа и ПРОЙДЕН; второй открыт явно и
  // пройден наполовину; третий заперт.
  await completeLesson(doneLessonId);
  await completeLesson(activeDoneLessonId);
  await testDb.courseAccess.create({
    data: {
      userId: studentId,
      courseId: activeCourseId,
      unlockedAt: new Date(),
      unlockedBy: "system",
    },
  });
});

describe("getQuestionAccess — два уровня доступа", () => {
  it("пройденный курс открывает свою категорию целиком", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(doneCategoryId)).toBe(true);
    // Именно категорией, а не поимённо: у вопроса нет ни одной ключевой привязки.
    expect(access.questionIds.has(qDoneId)).toBe(false);
  });

  it("курс в процессе категорию целиком НЕ открывает", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(activeCategoryId)).toBe(false);
    expect(access.categoryIds.has(activeSubId)).toBe(false);
  });

  it("курс в процессе открывает ключевые вопросы пройденных уроков — поимённо", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.questionIds.has(qActiveKeyDoneId)).toBe(true);
    expect(access.questionIds.has(qActiveKeyPendingId)).toBe(false);
    expect(access.questionIds.has(qActivePlainId)).toBe(false);
  });

  it("завершение курса открывает всю категорию, а не только ключевые", async () => {
    await completeLesson(activePendingLessonId);
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(activeCategoryId)).toBe(true);
    expect(access.categoryIds.has(activeSubId)).toBe(true);
  });

  it("запертый курс не даёт ничего", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.categoryIds.has(lockedCategoryId)).toBe(false);
    expect(access.categoryIds.has(lockedSubId)).toBe(false);
    expect(access.questionIds.has(qLockedId)).toBe(false);
  });

  it("категория без курса — общий пул, видна всем", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.sharedCategoryIds.has(sharedCategoryId)).toBe(true);
    expect(access.categoryIds.has(sharedCategoryId)).toBe(true);
  });

  it("вопрос без эталона поимённого доступа не получает", async () => {
    const blank = await makeQuestion(activeCategoryId, "Ключевой без эталона", null);
    await testDb.questionLesson.create({
      data: { lessonId: activeDoneLessonId, questionId: blank.id, isKey: true, inQuiz: false },
    });
    const access = await getQuestionAccess(testDb, studentId);
    expect(access.questionIds.has(blank.id)).toBe(false);
  });
});

describe("каталог /questions фильтруется тем же доступом", () => {
  async function catalogTexts() {
    const access = await getQuestionAccess(testDb, studentId);
    const { groups } = await listQuestionsCatalogGrouped(testDb, { access });
    return groups.flatMap((g) => g.questions.map((q) => q.teaser)).join(" | ");
  }

  it("показывает пройденную категорию, общий пул и ключевые пройденных уроков", async () => {
    const texts = await catalogTexts();
    expect(texts).toContain("Вопрос пройденного курса");
    expect(texts).toContain("Вопрос общего пула");
    expect(texts).toContain("Ключевой пройденного урока");
  });

  it("прячет запертое, непройденное и вопрос без эталона", async () => {
    const texts = await catalogTexts();
    expect(texts).not.toContain("Вопрос запертого курса");
    expect(texts).not.toContain("Вопрос подкатегории запертого");
    expect(texts).not.toContain("Ключевой непройденного урока");
    expect(texts).not.toContain("Просто привязанный");
    expect(texts).not.toContain("Вопрос без эталона");
  });

  it("пустой доступ — честный ноль, а не «показать всё»", async () => {
    const { groups, total } = await listQuestionsCatalogGrouped(testDb, {
      access: {
        categoryIds: new Set<string>(),
        sharedCategoryIds: new Set<string>(),
        questionIds: new Set<string>(),
        openCourses: [],
      },
    });
    expect(total).toBe(0);
    expect(groups).toEqual([]);
  });

  it("выбор категории не открывает то, что цепь закрыла", async () => {
    const access = await getQuestionAccess(testDb, studentId);
    const { total } = await listQuestionsCatalogGrouped(testDb, {
      categoryId: lockedCategoryId,
      access,
    });
    expect(total).toBe(0);
  });
});

describe("свободная тренировка собирается по тому же правилу", () => {
  it("набор по курсу в процессе — только вопросы пройденных уроков", async () => {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "course", courseId: activeCourseId },
      size: "all",
    });
    expect(set.map((q) => q.id)).toEqual([qActiveKeyDoneId]);
  });

  it("набор по запертому курсу пуст", async () => {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "course", courseId: lockedCourseId },
      size: "all",
    });
    expect(set).toEqual([]);
  });

  it("набор по категории общего пула не содержит вопрос без эталона", async () => {
    const set = await buildFreeTrainingSet(testDb, {
      userId: studentId,
      source: { kind: "category", categoryId: sharedCategoryId },
      size: "all",
    });
    expect(set.map((q) => q.id)).toEqual([qSharedId]);
    expect(set.map((q) => q.id)).not.toContain(qNoAnswerId);
  });

  it("счётчик набора по курсу показывает честное число", async () => {
    const sources = await listFreeTrainingSources(testDb, studentId);
    const active = sources.courses.find((c) => c.id === activeCourseId);
    expect(active?.questions).toBe(1);
    expect(sources.courses.some((c) => c.id === lockedCourseId)).toBe(false);
  });
});

describe("очередь SRS подчиняется доступу и эталону", () => {
  async function card(questionId: string) {
    await testDb.srsCard.create({
      data: {
        userId: studentId,
        questionId,
        step: 0,
        nextReviewAt: new Date("2026-01-01T00:00:00.000Z"),
        addedFrom: "manual",
      },
    });
  }

  it("накопленная карточка закрытой категории скрыта, но не удалена", async () => {
    await card(qLockedId);
    const queue = await getSrsQueue(testDb, { userId: studentId });
    expect(queue.cards.map((c) => c.questionId)).not.toContain(qLockedId);
    expect(await testDb.srsCard.count({ where: { questionId: qLockedId } })).toBe(1);
  });

  it("карточка вопроса без эталона в очередь не попадает", async () => {
    await card(qNoAnswerId);
    const queue = await getSrsQueue(testDb, { userId: studentId });
    expect(queue.cards.map((c) => c.questionId)).not.toContain(qNoAnswerId);
  });

  it("ключевой вопрос пройденного урока в очереди виден", async () => {
    await card(qActiveKeyDoneId);
    const queue = await getSrsQueue(testDb, { userId: studentId });
    expect(queue.cards.map((c) => c.questionId)).toContain(qActiveKeyDoneId);
  });
});

describe("предзаполнение связи по существующим привязкам вопрос→урок", () => {
  it("категория относится к курсу, если её вопросы привязаны к его урокам", async () => {
    const rows = await computeCourseCategoryPrefill(testDb);
    const row = rows.find(
      (r) => r.courseId === activeCourseId && r.categoryId === activeCategoryId,
    );
    expect(row).toBeDefined();
    expect(row!.questions).toBe(2);
  });

  it("курс без привязанных вопросов в предзаполнение не попадает", async () => {
    const rows = await computeCourseCategoryPrefill(testDb);
    expect(rows.some((r) => r.courseId === doneCourseId)).toBe(false);
  });
});
