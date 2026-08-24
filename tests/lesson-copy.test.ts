import { beforeEach, describe, expect, it } from "vitest";
import { copyLesson, deleteLesson } from "@/lib/services/content-admin";
import { copyLessonAsStep } from "@/lib/services/lesson-steps";
import { createTestUser, resetDb, testDb } from "./helpers/db";

beforeEach(async () => resetDb());

async function baseFixture() {
  const mentor = await createTestUser({ email: "mentor@lesson-copy.test", role: "mentor" });
  const student = await createTestUser({ email: "student@lesson-copy.test" });
  const category = await testDb.questionCategory.create({
    data: { title: "Копирование", slug: "lesson-copy", colorIndex: 0 },
  });
  const course = await testDb.course.create({
    data: {
      title: "Исходный курс",
      slug: "copy-source",
      modules: {
        create: [
          { title: "Источник", order: 0 },
          { title: "Цель", order: 1 },
        ],
      },
    },
    include: { modules: { orderBy: { order: "asc" } } },
  });
  return {
    mentor,
    student,
    category,
    sourceModule: course.modules[0]!,
    targetModule: course.modules[1]!,
  };
}

describe("копирование уроков", () => {
  it("создаёт независимый полный черновик со шагами и ролями вопросов, но без прогресса", async () => {
    const { mentor, student, category, sourceModule, targetModule } = await baseFixture();
    const source = await testDb.lesson.create({
      data: {
        moduleId: sourceModule.id,
        title: "Большой урок",
        slug: "big-lesson",
        status: "published",
        difficulty: "advanced",
        isOptional: true,
        contentMd: "## Теория\n\nТекст\n\n## Практика\n\nЗадание",
        readingMinutes: 7,
        pathPolicy: "choose_one",
        textMinutes: 8,
        videoMinutes: 12,
        practiceMinutes: 15,
        videoUrl: "https://youtu.be/copy-source",
        publishedAt: new Date("2026-08-20T00:00:00Z"),
        steps: {
          create: [
            { title: "Теория", order: 0, contentMd: "Текст", readingMinutes: 2 },
            { title: "Практика", order: 1, contentMd: "Задание", readingMinutes: 3 },
          ],
        },
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    const questions = await Promise.all(
      ["Вопрос шага", "Вопрос урока"].map((textMd) =>
        testDb.question.create({
          data: {
            categoryId: category.id,
            type: "open",
            status: "published",
            textMd,
            answerMd: "Ответ",
          },
        }),
      ),
    );
    await testDb.questionLesson.createMany({
      data: [
        {
          questionId: questions[0]!.id,
          lessonId: source.id,
          stepId: source.steps[0]!.id,
          isKey: true,
          inQuiz: false,
        },
        {
          questionId: questions[1]!.id,
          lessonId: source.id,
          stepId: null,
          isKey: false,
          inQuiz: true,
        },
      ],
    });
    await testDb.lessonProgress.create({
      data: {
        userId: student.id,
        lessonId: source.id,
        status: "completed",
        completedAt: new Date(),
      },
    });
    await testDb.lessonStepProgress.create({
      data: {
        userId: student.id,
        stepId: source.steps[0]!.id,
        status: "completed",
        completedAt: new Date(),
      },
    });

    const result = await copyLesson(testDb, {
      actorId: mentor.id,
      sourceLessonId: source.id,
      targetModuleId: targetModule.id,
      title: "Большой урок — копия",
    });
    expect(result).toMatchObject({ copiedStepCount: 2, copiedQuestionCount: 2 });

    const copy = await testDb.lesson.findUniqueOrThrow({
      where: { id: result!.id },
      include: {
        steps: { orderBy: { order: "asc" } },
        questionLinks: { orderBy: { questionId: "asc" } },
        progress: true,
      },
    });
    expect(copy).toMatchObject({
      moduleId: targetModule.id,
      title: "Большой урок — копия",
      status: "draft",
      difficulty: "advanced",
      isOptional: true,
      contentMd: source.contentMd,
      pathPolicy: "choose_one",
      textMinutes: 8,
      videoMinutes: 12,
      practiceMinutes: 15,
      videoUrl: source.videoUrl,
      publishedAt: null,
      progress: [],
    });
    expect(copy.id).not.toBe(source.id);
    expect(copy.slug).not.toBe(source.slug);
    expect(copy.steps.map((step) => [step.title, step.contentMd])).toEqual([
      ["Теория", "Текст"],
      ["Практика", "Задание"],
    ]);
    expect(copy.steps.every((step) => !source.steps.some((item) => item.id === step.id))).toBe(
      true,
    );
    expect(copy.questionLinks).toHaveLength(2);
    expect(copy.questionLinks.find((link) => link.questionId === questions[0]!.id)?.stepId).toBe(
      copy.steps[0]!.id,
    );
    expect(
      copy.questionLinks.find((link) => link.questionId === questions[1]!.id)?.stepId,
    ).toBeNull();
    await expect(
      testDb.lessonStepProgress.count({ where: { step: { lessonId: copy.id } } }),
    ).resolves.toBe(0);

    await testDb.lessonStep.update({
      where: { id: copy.steps[0]!.id },
      data: { contentMd: "Изменено только в копии" },
    });
    await expect(
      testDb.lessonStep.findUniqueOrThrow({ where: { id: source.steps[0]!.id } }),
    ).resolves.toMatchObject({ contentMd: "Текст" });
    await expect(deleteLesson(testDb, { actorId: mentor.id, lessonId: copy.id })).resolves.toEqual({
      ok: true,
    });
    await expect(testDb.lesson.findUnique({ where: { id: source.id } })).resolves.not.toBeNull();
    await expect(
      testDb.auditLog.findFirst({ where: { action: "lesson.copied", entityId: result!.id } }),
    ).resolves.toMatchObject({ actorId: mentor.id });
  });

  it("добавляет цельный урок как шаг, переносит видео и пропускает уже связанные вопросы", async () => {
    const { mentor, category, sourceModule, targetModule } = await baseFixture();
    const source = await testDb.lesson.create({
      data: {
        moduleId: sourceModule.id,
        title: "Урок-источник",
        slug: "source-as-step",
        contentMd: "# Заголовок\n\nДлинный материал с `кодом`.",
        videoUrl: "https://youtu.be/source-video",
      },
    });
    const target = await testDb.lesson.create({
      data: {
        moduleId: targetModule.id,
        title: "Составной урок",
        slug: "target-with-step",
        contentMd: "Исходный материал цели",
      },
    });
    const questions = await Promise.all(
      ["Новый вопрос", "Уже в цели"].map((textMd) =>
        testDb.question.create({
          data: {
            categoryId: category.id,
            type: "open",
            status: "published",
            textMd,
            answerMd: "Ответ",
          },
        }),
      ),
    );
    await testDb.questionLesson.createMany({
      data: [
        { questionId: questions[0]!.id, lessonId: source.id, isKey: true },
        { questionId: questions[1]!.id, lessonId: source.id, inQuiz: true },
        { questionId: questions[1]!.id, lessonId: target.id, isKey: true },
      ],
    });

    const result = await copyLessonAsStep(testDb, {
      actorId: mentor.id,
      sourceLessonId: source.id,
      targetLessonId: target.id,
      title: "Импортированный шаг",
    });
    expect(result).toMatchObject({
      ok: true,
      copiedQuestionCount: 1,
      skippedQuestionCount: 1,
      recordingNotice: false,
    });
    if (!result.ok) throw new Error("copy failed");

    const steps = await testDb.lessonStep.findMany({
      where: { lessonId: target.id },
      orderBy: { order: "asc" },
    });
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ title: "Материал", contentMd: "Исходный материал цели" });
    expect(steps[1]!.id).toBe(result.id);
    expect(steps[1]!.contentMd).toContain(
      ':::video{url="https://youtu.be/source-video" title="Урок-источник"}',
    );
    expect(steps[1]!.contentMd).toContain("Длинный материал с `кодом`.");
    const targetLinks = await testDb.questionLesson.findMany({ where: { lessonId: target.id } });
    expect(targetLinks).toHaveLength(2);
    expect(targetLinks.find((link) => link.questionId === questions[0]!.id)).toMatchObject({
      stepId: result.id,
      isKey: true,
    });
    expect(targetLinks.find((link) => link.questionId === questions[1]!.id)).toMatchObject({
      stepId: null,
      isKey: true,
    });
    await expect(
      testDb.lesson.findUniqueOrThrow({ where: { id: source.id } }),
    ).resolves.toMatchObject({
      contentMd: source.contentMd,
      videoUrl: source.videoUrl,
    });
    await expect(
      testDb.auditLog.findFirst({
        where: { action: "lesson_step.copied_from_lesson", entityId: result.id },
      }),
    ).resolves.toMatchObject({ actorId: mentor.id });
  });

  it("не позволяет импортировать урок в самого себя", async () => {
    const { mentor, sourceModule } = await baseFixture();
    const lesson = await testDb.lesson.create({
      data: { moduleId: sourceModule.id, title: "Сам урок", slug: "same-lesson" },
    });
    await expect(
      copyLessonAsStep(testDb, {
        actorId: mentor.id,
        sourceLessonId: lesson.id,
        targetLessonId: lesson.id,
        title: lesson.title,
      }),
    ).resolves.toEqual({ ok: false, code: "same_lesson" });
  });

  it("не добавляет защищённую запись в опубликованный урок", async () => {
    const { mentor, sourceModule, targetModule } = await baseFixture();
    const source = await testDb.lesson.create({
      data: {
        moduleId: sourceModule.id,
        title: "Запись интервью",
        slug: "protected-source",
        contentMd: "Запись собеседования: https://disk.yandex.ru/i/secret\n\nПароль: 1234",
      },
    });
    const target = await testDb.lesson.create({
      data: {
        moduleId: targetModule.id,
        title: "Опубликованная цель",
        slug: "published-target",
        status: "published",
        contentMd: "Безопасный текст",
      },
    });

    await expect(
      copyLessonAsStep(testDb, {
        actorId: mentor.id,
        sourceLessonId: source.id,
        targetLessonId: target.id,
        title: source.title,
      }),
    ).resolves.toEqual({ ok: false, code: "unsafe_recording_reference" });
    await expect(testDb.lessonStep.count({ where: { lessonId: target.id } })).resolves.toBe(0);
    await expect(
      testDb.lesson.findUniqueOrThrow({ where: { id: target.id } }),
    ).resolves.toMatchObject({
      contentMd: "Безопасный текст",
    });
  });
});
