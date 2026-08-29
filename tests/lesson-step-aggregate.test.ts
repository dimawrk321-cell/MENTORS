import { beforeEach, describe, expect, it } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import {
  createLessonStep,
  renameLessonStep,
  saveLessonStep,
  setLessonStepStatus,
  splitLessonIntoSteps,
} from "@/lib/services/lesson-steps";
import { buildLessonAggregate } from "@/lib/utils/lesson-aggregate";
import { findStepDuplicates } from "@/lib/services/lesson-step-duplicates";
import { matchStepDuplicates, stepDuplicateReason } from "@/lib/utils/lesson-step-duplicates";

beforeEach(async () => resetDb());

const AUTHORED = "# Авторский текст\n\nЭто написал ментор.";

async function fixture(lessonStatus: "draft" | "published" = "published") {
  const mentor = await createTestUser({ email: "mentor@aggregate.test", role: "mentor" });
  const course = await testDb.course.create({
    data: {
      title: "Курс",
      slug: "aggregate-course",
      status: "published",
      gating: "free",
      modules: {
        create: {
          title: "Раздел",
          order: 0,
          status: "published",
          lessons: {
            create: {
              title: "Урок",
              slug: "aggregate-lesson",
              order: 0,
              status: lessonStatus,
              contentMd: AUTHORED,
            },
          },
        },
      },
    },
    include: { modules: { include: { lessons: true } } },
  });
  return { mentor, course, lesson: course.modules[0]!.lessons[0]! };
}

function aggregateOf(lessonId: string) {
  return testDb.lesson.findUniqueOrThrow({
    where: { id: lessonId },
    select: { contentMd: true, readingMinutes: true, contentUpdatedAt: true },
  });
}

describe("агрегат шагов (заход C.10)", () => {
  it("собирается только из написанного: названия шагов заголовками не подставляются", () => {
    expect(
      buildLessonAggregate([
        { contentMd: "  Первая часть  " },
        { contentMd: "" },
        { contentMd: "Вторая часть" },
      ]),
    ).toBe("Первая часть\n\nВторая часть");
  });

  it("название шага не попадает в content_md урока", async () => {
    const { mentor, lesson } = await fixture();
    await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });

    const aggregate = await aggregateOf(lesson.id);
    expect(aggregate.contentMd).toBe(AUTHORED);
    expect(aggregate.contentMd).not.toContain("## Материал");
  });

  it("переименование шага не меняет агрегат и не рассылает «урок обновлён»", async () => {
    const { mentor, lesson } = await fixture();
    const step = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const before = await aggregateOf(lesson.id);

    await renameLessonStep(testDb, {
      actorId: mentor.id,
      stepId: step.id,
      title: "Совсем другое название",
    });

    const after = await aggregateOf(lesson.id);
    expect(after.contentMd).toBe(before.contentMd);
    expect(after.contentUpdatedAt.getTime()).toBe(before.contentUpdatedAt.getTime());
  });

  it("пустая проекция не затирает авторский текст черновика", async () => {
    // Первый «Материал» наследует статус урока, то есть у черновика он черновик,
    // и опубликованных шагов нет вовсе. Прежняя сборка писала в колонку пустую
    // строку — вместе с ней ломались гейт массовой публикации, авторизация
    // встроенного вопроса, греп `:::mock` и запасной текст читалки.
    const { mentor, lesson } = await fixture("draft");
    const step = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    await expect(
      testDb.lessonStep.findUniqueOrThrow({ where: { id: step.id }, select: { status: true } }),
    ).resolves.toEqual({ status: "draft" });

    const afterSplit = await aggregateOf(lesson.id);
    expect(afterSplit.contentMd).toBe(AUTHORED);
    expect(afterSplit.readingMinutes).toBeGreaterThan(0);

    await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
      title: "Ещё черновик",
    });
    await expect(aggregateOf(lesson.id)).resolves.toMatchObject({ contentMd: AUTHORED });

    // Как только шаг становится видимым, проекция берёт своё.
    await saveLessonStep(testDb, { stepId: step.id, contentMd: "# Переписанный шаг" });
    await setLessonStepStatus(testDb, { actorId: mentor.id, stepId: step.id, status: "published" });
    await expect(aggregateOf(lesson.id)).resolves.toMatchObject({
      contentMd: "# Переписанный шаг",
    });
  });
});

describe("правило совпадения урока и шага (заход C.10)", () => {
  const lesson = { title: "Классические языковые модели", contentMd: "# Текст\n\nАбзац." };

  it("ловит побайтовую копию и копию с приклеенным видео источника", () => {
    expect(stepDuplicateReason(lesson, { title: "Другое", contentMd: "# Текст\n\nАбзац." })).toBe(
      "content",
    );
    expect(
      stepDuplicateReason(lesson, {
        title: "Другое",
        contentMd: ':::video{url="https://youtu.be/x" title="t"}\n:::\n\n# Текст\n\nАбзац.',
      }),
    ).toBe("content");
  });

  it("ловит копию с изменённым текстом по названию, взятому от источника", () => {
    expect(
      stepDuplicateReason(lesson, {
        title: "  классические   ЯЗЫКОВЫЕ модели ",
        contentMd: "Совсем другой материал",
      }),
    ).toBe("title");
  });

  it("не считает совпадением разные название и текст", () => {
    expect(
      stepDuplicateReason(lesson, { title: "Шаг", contentMd: "Совсем другой материал" }),
    ).toBeNull();
  });

  it("не считает дублем собственный шаг урока и чужой курс", () => {
    const lessons = [{ id: "L1", courseId: "C1", title: "Урок", contentMd: "# Текст" }];
    expect(
      matchStepDuplicates(lessons, [
        {
          id: "S1",
          title: "Материал",
          contentMd: "# Текст",
          status: "published",
          lessonId: "L1",
          lessonTitle: "Урок",
          lessonStatus: "published",
          courseId: "C1",
        },
        {
          id: "S2",
          title: "Материал",
          contentMd: "# Текст",
          status: "published",
          lessonId: "L9",
          lessonTitle: "Чужой курс",
          lessonStatus: "published",
          courseId: "C2",
        },
      ]),
    ).toEqual([]);
  });

  it("находит опубликованный урок, скопированный шагом в другой урок того же курса", async () => {
    const { mentor, course, lesson: host } = await fixture();
    const source = await testDb.lesson.create({
      data: {
        moduleId: course.modules[0]!.id,
        title: "Источник",
        slug: "source-lesson",
        order: 1,
        status: "published",
        contentMd: "# Материал источника",
      },
    });
    await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: host.id });
    const copied = await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: host.id,
      title: source.title,
    });
    await saveLessonStep(testDb, { stepId: copied.id, contentMd: source.contentMd });
    await setLessonStepStatus(testDb, {
      actorId: mentor.id,
      stepId: copied.id,
      status: "published",
    });

    const found = await findStepDuplicates(testDb, [course.id]);
    expect(found).toEqual([
      expect.objectContaining({
        lessonId: source.id,
        stepId: copied.id,
        stepLessonId: host.id,
        reason: "content",
        visibleTwice: true,
      }),
    ]);

    // Уведён в черновик руками — источник больше не виден ученику, предупреждать не о чем.
    await testDb.lesson.update({ where: { id: source.id }, data: { status: "draft" } });
    await expect(findStepDuplicates(testDb, [course.id])).resolves.toEqual([]);
  });
});
