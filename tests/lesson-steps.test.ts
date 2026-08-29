import { beforeEach, describe, expect, it } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import {
  completeLessonStep,
  createLessonStep,
  deleteLessonStep,
  moveLessonStep,
  saveLessonStep,
  setLessonStepStatus,
  splitLessonIntoSteps,
} from "@/lib/services/lesson-steps";
import { getLessonView } from "@/lib/services/content";
import { getKeyQuestionsForLesson, upsertQuestionLessonLink } from "@/lib/services/questions";

beforeEach(async () => resetDb());

async function fixture() {
  const mentor = await createTestUser({ email: "mentor@steps.test", role: "mentor" });
  const student = await createTestUser({
    email: "student@steps.test",
    activatedAt: new Date("2026-08-01T00:00:00Z"),
    accessUntil: new Date("2027-08-01T00:00:00Z"),
  });
  const course = await testDb.course.create({
    data: {
      title: "Курс",
      slug: "steps-course",
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
              slug: "lesson",
              order: 0,
              status: "published",
              contentMd: "# Старый материал",
            },
          },
        },
      },
    },
    include: { modules: { include: { lessons: true } } },
  });
  return { mentor, student, lesson: course.modules[0]!.lessons[0]! };
}

describe("шаги урока", () => {
  it("не меняет старый урок сам и копирует его текст только при явном разделении", async () => {
    const { mentor, student, lesson } = await fixture();
    expect((await getLessonView(testDb, lesson.id, student.id))?.lessonSteps).toEqual([]);

    const first = await splitLessonIntoSteps(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
    });
    const view = await getLessonView(testDb, lesson.id, student.id);
    expect(view?.lessonSteps).toHaveLength(1);
    expect(view?.lessonSteps[0]).toMatchObject({
      id: first.id,
      title: "Материал",
      contentMd: "# Старый материал",
    });
  });

  it("завершает шаги последовательно и выдаёт завершение урока только на последнем", async () => {
    const { mentor, student, lesson } = await fixture();
    const first = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const second = await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
      title: "Практика",
    });
    await testDb.lessonStep.update({ where: { id: second.id }, data: { contentMd: "# Практика" } });
    await setLessonStepStatus(testDb, {
      actorId: mentor.id,
      stepId: second.id,
      status: "published",
    });

    await expect(getLessonView(testDb, lesson.id, student.id)).resolves.toMatchObject({
      lessonSteps: [
        { id: first.id, unlocked: true, completedAt: null },
        { id: second.id, unlocked: false, completedAt: null },
      ],
    });

    expect(
      await completeLessonStep(testDb, {
        userId: student.id,
        lessonId: lesson.id,
        stepId: second.id,
      }),
    ).toEqual({
      ok: false,
      code: "previous_step_required",
    });
    expect(
      await completeLessonStep(testDb, {
        userId: student.id,
        lessonId: lesson.id,
        stepId: first.id,
      }),
    ).toEqual({
      ok: true,
      nextStepId: second.id,
      lessonCompleted: false,
    });
    expect(
      await testDb.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: student.id, lessonId: lesson.id } },
      }),
    ).toBeNull();
    await expect(getLessonView(testDb, lesson.id, student.id)).resolves.toMatchObject({
      lessonSteps: [
        { id: first.id, unlocked: true },
        { id: second.id, unlocked: true },
      ],
    });

    const final = await completeLessonStep(testDb, {
      userId: student.id,
      lessonId: lesson.id,
      stepId: second.id,
    });
    expect(final).toMatchObject({ ok: true, nextStepId: null, lessonCompleted: true });
    expect(
      (
        await testDb.lessonProgress.findUnique({
          where: { userId_lessonId: { userId: student.id, lessonId: lesson.id } },
        })
      )?.status,
    ).toBe("completed");
    await expect(getLessonView(testDb, lesson.id, student.id)).resolves.toMatchObject({
      lessonSteps: [
        { id: first.id, unlocked: true },
        { id: second.id, unlocked: true },
      ],
    });
  });

  it("сохраняет совместимость старого завершённого урока после добавления шагов", async () => {
    const { mentor, student, lesson } = await fixture();
    await testDb.lessonProgress.create({
      data: {
        userId: student.id,
        lessonId: lesson.id,
        status: "completed",
        completedAt: new Date("2026-08-24T10:00:00Z"),
      },
    });
    await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const second = await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
      title: "Добавленный позже шаг",
    });
    await testDb.lessonStep.update({
      where: { id: second.id },
      data: { contentMd: "# Новый шаг" },
    });
    await setLessonStepStatus(testDb, {
      actorId: mentor.id,
      stepId: second.id,
      status: "published",
    });

    const view = await getLessonView(testDb, lesson.id, student.id);
    expect(view?.lessonSteps).toHaveLength(2);
    expect(view?.lessonSteps.every((step) => step.completedAt !== null && step.unlocked)).toBe(
      true,
    );
  });

  it("скрывает черновики от ученика и защищает последний опубликованный шаг", async () => {
    const { mentor, student, lesson } = await fixture();
    const first = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const draft = await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
      title: "Новый черновик",
    });

    await expect(testDb.lessonStep.findUnique({ where: { id: draft.id } })).resolves.toMatchObject({
      status: "draft",
    });
    await expect(getLessonView(testDb, lesson.id, student.id)).resolves.toMatchObject({
      lessonSteps: [{ id: first.id }],
    });
    await expect(
      setLessonStepStatus(testDb, { actorId: mentor.id, stepId: first.id, status: "draft" }),
    ).resolves.toEqual({ ok: false, code: "last_published_step" });
    await expect(
      deleteLessonStep(testDb, { actorId: mentor.id, stepId: first.id }),
    ).resolves.toEqual({ ok: false, code: "last_published_step" });
    await expect(
      setLessonStepStatus(testDb, { actorId: mentor.id, stepId: draft.id, status: "published" }),
    ).resolves.toEqual({ ok: false, code: "empty_content" });

    await testDb.lessonStep.update({ where: { id: draft.id }, data: { contentMd: "# Материал" } });
    await expect(
      setLessonStepStatus(testDb, { actorId: mentor.id, stepId: draft.id, status: "published" }),
    ).resolves.toEqual({ ok: true, lessonId: lesson.id });
    await expect(getLessonView(testDb, lesson.id, student.id)).resolves.toMatchObject({
      lessonSteps: [{ id: first.id }, { id: draft.id }],
    });
    await expect(
      testDb.auditLog.findFirst({ where: { action: "lesson_step.published", entityId: draft.id } }),
    ).resolves.toMatchObject({ actorId: mentor.id });
  });

  it("после автосохранения возвращает минуты шага и актуальный агрегат урока", async () => {
    const { mentor, lesson } = await fixture();
    const first = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const second = await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
      title: "Вторая часть",
    });
    await saveLessonStep(testDb, { stepId: second.id, contentMd: "слово ".repeat(450) });

    const draftSave = await saveLessonStep(testDb, {
      stepId: first.id,
      contentMd: "слово ".repeat(220),
    });
    const aggregateBeforePublish = await testDb.lesson.findUniqueOrThrow({
      where: { id: lesson.id },
      select: { readingMinutes: true },
    });
    expect(draftSave).toMatchObject({
      ok: true,
      readingMinutes: 2,
      lessonReadingMinutes: aggregateBeforePublish.readingMinutes,
    });

    await setLessonStepStatus(testDb, {
      actorId: mentor.id,
      stepId: second.id,
      status: "published",
    });
    const publishedSave = await saveLessonStep(testDb, {
      stepId: second.id,
      contentMd: "слово ".repeat(610),
    });
    const aggregateAfterSave = await testDb.lesson.findUniqueOrThrow({
      where: { id: lesson.id },
      select: { readingMinutes: true },
    });
    expect(publishedSave).toMatchObject({
      ok: true,
      readingMinutes: 4,
      lessonReadingMinutes: aggregateAfterSave.readingMinutes,
    });
  });

  it("не позволяет вынести из урока последний шаг", async () => {
    const { mentor, lesson } = await fixture();
    const first = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const target = await testDb.lesson.create({
      data: { moduleId: lesson.moduleId, title: "Цель", slug: "target", order: 1, status: "draft" },
    });
    await expect(
      moveLessonStep(testDb, {
        actorId: mentor.id,
        stepId: first.id,
        targetLessonId: target.id,
        targetIndex: 0,
      }),
    ).rejects.toThrow("last_step");
  });

  it("удаляет выбранный шаг вместе с его прогрессом, не затрагивая остальные шаги", async () => {
    const { mentor, student, lesson } = await fixture();
    const first = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const second = await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
      title: "Случайный шаг",
    });
    await testDb.lessonStepProgress.createMany({
      data: [
        { userId: student.id, stepId: first.id, status: "completed", completedAt: new Date() },
        { userId: student.id, stepId: second.id, status: "in_progress" },
      ],
    });

    await expect(
      deleteLessonStep(testDb, { actorId: mentor.id, stepId: second.id }),
    ).resolves.toMatchObject({ ok: true, deletedProgressCount: 1 });
    await expect(testDb.lessonStep.findUnique({ where: { id: second.id } })).resolves.toBeNull();
    await expect(
      testDb.lessonStepProgress.findMany({ where: { userId: student.id } }),
    ).resolves.toMatchObject([{ stepId: first.id, status: "completed" }]);

    const audit = await testDb.auditLog.findFirst({
      where: { action: "lesson_step.deleted", entityId: second.id },
    });
    expect(audit?.actorId).toBe(mentor.id);
    expect(audit?.before).toMatchObject({ deletedProgressCount: 1 });
  });

  it("показывает на шаге только его вопросы, а общие — на финальном шаге", async () => {
    const { mentor, lesson } = await fixture();
    const first = await splitLessonIntoSteps(testDb, { actorId: mentor.id, lessonId: lesson.id });
    const second = await createLessonStep(testDb, {
      actorId: mentor.id,
      lessonId: lesson.id,
      title: "Финал",
    });
    const category = await testDb.questionCategory.create({
      data: { title: "Категория", slug: "steps-category", colorIndex: 0 },
    });
    const questions = await Promise.all(
      ["Первый", "Общий"].map((textMd) =>
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
    await upsertQuestionLessonLink(testDb, {
      actorId: mentor.id,
      questionId: questions[0]!.id,
      lessonId: lesson.id,
      stepId: first.id,
      isKey: true,
      inQuiz: false,
    });
    await upsertQuestionLessonLink(testDb, {
      actorId: mentor.id,
      questionId: questions[1]!.id,
      lessonId: lesson.id,
      stepId: null,
      isKey: true,
      inQuiz: false,
    });

    expect(
      await getKeyQuestionsForLesson(testDb, lesson.id, {
        stepId: first.id,
        includeLessonLevel: false,
      }),
    ).toHaveLength(1);
    expect(
      await getKeyQuestionsForLesson(testDb, lesson.id, {
        stepId: second.id,
        includeLessonLevel: true,
      }),
    ).toHaveLength(1);
  });
});
