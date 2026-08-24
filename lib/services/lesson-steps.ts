import type { Prisma, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";
import { completeLesson, getLessonView } from "@/lib/services/content";
import { computeReadingMinutes } from "@/lib/utils/markdown";
import { hasUnsafeRecordingReference } from "@/lib/utils/content-safety";
import { notifyLessonUpdated } from "@/lib/services/content-admin";

type Tx = Prisma.TransactionClient;

async function parkStepOrders(tx: Tx, ids: string[]): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await tx.lessonStep.update({ where: { id }, data: { order: -100000 - index } });
  }
}

async function syncLessonAggregate(tx: Tx, lessonId: string): Promise<void> {
  const steps = await tx.lessonStep.findMany({
    where: { lessonId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { title: true, contentMd: true },
  });
  if (steps.length === 0) return;
  const contentMd = steps
    .map((step) => `## ${step.title}\n\n${step.contentMd.trim()}`.trim())
    .join("\n\n");
  await tx.lesson.update({
    where: { id: lessonId },
    data: {
      contentMd,
      readingMinutes: computeReadingMinutes(contentMd),
      contentUpdatedAt: new Date(),
    },
  });
}

function lessonMarkdownForStep(source: {
  title: string;
  contentMd: string;
  videoUrl: string | null;
}): string {
  const video = source.videoUrl
    ? `:::video{url=${JSON.stringify(source.videoUrl)} title=${JSON.stringify(source.title)}}\n:::`
    : "";
  return [video, source.contentMd.trim()].filter(Boolean).join("\n\n");
}

/** Converts a legacy lesson only when the mentor explicitly asks to split it. */
export async function splitLessonIntoSteps(
  db: PrismaClient,
  input: { actorId: string; lessonId: string },
): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const lesson = await tx.lesson.findUnique({
      where: { id: input.lessonId },
      include: { steps: { orderBy: { order: "asc" }, take: 1 } },
    });
    if (!lesson) throw new Error("lesson_not_found");
    if (lesson.steps[0]) return { id: lesson.steps[0].id };
    const step = await tx.lessonStep.create({
      data: {
        lessonId: lesson.id,
        title: "Материал",
        order: 0,
        contentMd: lesson.contentMd,
        readingMinutes: computeReadingMinutes(lesson.contentMd),
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "lesson.steps_enabled",
      entityType: "lesson",
      entityId: lesson.id,
      after: { firstStepId: step.id },
    });
    return { id: step.id };
  });
}

export async function createLessonStep(
  db: PrismaClient,
  input: { actorId: string; lessonId: string; title: string },
): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    const lesson = await tx.lesson.findUnique({
      where: { id: input.lessonId },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!lesson) throw new Error("lesson_not_found");
    if (lesson.steps.length === 0) {
      const firstStep = await tx.lessonStep.create({
        data: {
          lessonId: lesson.id,
          title: "Материал",
          order: 0,
          contentMd: lesson.contentMd,
          readingMinutes: computeReadingMinutes(lesson.contentMd),
        },
      });
      await writeAudit(tx, {
        actorId: input.actorId,
        action: "lesson.steps_enabled",
        entityType: "lesson",
        entityId: lesson.id,
        after: { firstStepId: firstStep.id, via: "step_create" },
      });
    }
    const order = lesson.steps.length === 0 ? 1 : lesson.steps.length;
    const step = await tx.lessonStep.create({
      data: { lessonId: lesson.id, title: input.title, order },
    });
    await syncLessonAggregate(tx, lesson.id);
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "lesson_step.created",
      entityType: "lesson_step",
      entityId: step.id,
      after: { lessonId: lesson.id, title: step.title, order },
    });
    return { id: step.id };
  });
}

export type CopyLessonAsStepResult =
  | {
      ok: true;
      id: string;
      copiedQuestionCount: number;
      skippedQuestionCount: number;
      recordingNotice: boolean;
    }
  | { ok: false; code: "not_found" | "same_lesson" | "unsafe_recording_reference" };

/** Copies a lesson snapshot into one independent step of another lesson. */
export async function copyLessonAsStep(
  db: PrismaClient,
  input: {
    actorId: string;
    sourceLessonId: string;
    targetLessonId: string;
    title: string;
  },
): Promise<CopyLessonAsStepResult> {
  if (input.sourceLessonId === input.targetLessonId) {
    return { ok: false, code: "same_lesson" };
  }
  const result = await db.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.lesson.findUnique({
        where: { id: input.sourceLessonId },
        select: {
          id: true,
          title: true,
          contentMd: true,
          videoUrl: true,
          questionLinks: {
            orderBy: { createdAt: "asc" },
            select: { questionId: true, isKey: true, inQuiz: true },
          },
        },
      }),
      tx.lesson.findUnique({
        where: { id: input.targetLessonId },
        select: {
          id: true,
          status: true,
          contentMd: true,
          steps: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
          questionLinks: { select: { questionId: true } },
        },
      }),
    ]);
    if (!source || !target) return { ok: false, code: "not_found" } as const;

    const contentMd = lessonMarkdownForStep(source);
    const recordingNotice = hasUnsafeRecordingReference(contentMd);
    if (target.status === "published" && recordingNotice) {
      return { ok: false, code: "unsafe_recording_reference" } as const;
    }

    let enabledSteps = false;
    if (target.steps.length === 0) {
      await tx.lessonStep.create({
        data: {
          lessonId: target.id,
          title: "Материал",
          order: 0,
          contentMd: target.contentMd,
          readingMinutes: computeReadingMinutes(target.contentMd),
        },
      });
      enabledSteps = true;
    }
    const step = await tx.lessonStep.create({
      data: {
        lessonId: target.id,
        title: input.title,
        order: target.steps.length === 0 ? 1 : target.steps.length,
        contentMd,
        readingMinutes: computeReadingMinutes(contentMd),
      },
    });

    const existingQuestions = new Set(target.questionLinks.map((link) => link.questionId));
    const questionLinks = source.questionLinks.filter(
      (link) => !existingQuestions.has(link.questionId),
    );
    let copiedQuestionCount = 0;
    if (questionLinks.length > 0) {
      const created = await tx.questionLesson.createMany({
        data: questionLinks.map((link) => ({
          questionId: link.questionId,
          lessonId: target.id,
          stepId: step.id,
          isKey: link.isKey,
          inQuiz: link.inQuiz,
        })),
        skipDuplicates: true,
      });
      copiedQuestionCount = created.count;
    }
    await syncLessonAggregate(tx, target.id);
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "lesson_step.copied_from_lesson",
      entityType: "lesson_step",
      entityId: step.id,
      after: {
        sourceLessonId: source.id,
        targetLessonId: target.id,
        title: step.title,
        enabledSteps,
        copiedQuestionCount,
        skippedQuestionCount: source.questionLinks.length - copiedQuestionCount,
      },
    });
    return {
      ok: true,
      id: step.id,
      copiedQuestionCount,
      skippedQuestionCount: source.questionLinks.length - copiedQuestionCount,
      recordingNotice,
      targetPublished: target.status === "published",
    } as const;
  });
  if (!result.ok) return result;
  if (result.targetPublished) await notifyLessonUpdated(db, input.targetLessonId);
  return {
    ok: true,
    id: result.id,
    copiedQuestionCount: result.copiedQuestionCount,
    skippedQuestionCount: result.skippedQuestionCount,
    recordingNotice: result.recordingNotice,
  };
}

/** Content autosave is intentionally not audited; title changes are audited by the caller action. */
export async function saveLessonStep(
  db: PrismaClient,
  input: { stepId: string; title?: string; contentMd?: string },
): Promise<
  | { ok: true; lessonId: string; recordingNotice: boolean }
  | { ok: false; code: "not_found" | "unsafe_recording_reference" }
> {
  const result = await db.$transaction(async (tx) => {
    const step = await tx.lessonStep.findUnique({
      where: { id: input.stepId },
      include: { lesson: { select: { status: true } } },
    });
    if (!step) return { ok: false, code: "not_found" } as const;
    const contentMd = input.contentMd ?? step.contentMd;
    const recordingNotice = hasUnsafeRecordingReference(contentMd);
    if (step.lesson.status === "published" && recordingNotice) {
      return { ok: false, code: "unsafe_recording_reference" } as const;
    }
    const contentChanged = input.contentMd !== undefined && input.contentMd !== step.contentMd;
    await tx.lessonStep.update({
      where: { id: step.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.contentMd !== undefined
          ? { contentMd, readingMinutes: computeReadingMinutes(contentMd) }
          : {}),
      },
    });
    await syncLessonAggregate(tx, step.lessonId);
    return { ok: true, lessonId: step.lessonId, recordingNotice, contentChanged } as const;
  });
  if (result.ok && result.contentChanged) await notifyLessonUpdated(db, result.lessonId);
  return result.ok
    ? { ok: true, lessonId: result.lessonId, recordingNotice: result.recordingNotice }
    : result;
}

export async function renameLessonStep(
  db: PrismaClient,
  input: { actorId: string; stepId: string; title: string },
): Promise<{ lessonId: string } | null> {
  return db.$transaction(async (tx) => {
    const step = await tx.lessonStep.findUnique({ where: { id: input.stepId } });
    if (!step) return null;
    if (step.title === input.title) return { lessonId: step.lessonId };
    await tx.lessonStep.update({ where: { id: step.id }, data: { title: input.title } });
    await syncLessonAggregate(tx, step.lessonId);
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "lesson_step.renamed",
      entityType: "lesson_step",
      entityId: step.id,
      before: { title: step.title },
      after: { title: input.title },
    });
    return { lessonId: step.lessonId };
  });
}

export async function moveLessonStep(
  db: PrismaClient,
  input: { actorId: string; stepId: string; targetLessonId: string; targetIndex: number },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const step = await tx.lessonStep.findUnique({
      where: { id: input.stepId },
      include: { questionLinks: { select: { questionId: true } } },
    });
    const target = await tx.lesson.findUnique({
      where: { id: input.targetLessonId },
      select: { id: true, contentMd: true, _count: { select: { steps: true } } },
    });
    if (!step || !target) throw new Error("not_found");
    const sourceLessonId = step.lessonId;
    const source = await tx.lessonStep.findMany({
      where: { lessonId: sourceLessonId, id: { not: step.id } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (sourceLessonId !== target.id && source.length === 0) throw new Error("last_step");
    if (sourceLessonId !== target.id && step.questionLinks.length > 0) {
      const conflict = await tx.questionLesson.findFirst({
        where: {
          lessonId: target.id,
          questionId: { in: step.questionLinks.map((link) => link.questionId) },
        },
        select: { id: true },
      });
      if (conflict) throw new Error("question_conflict");
    }
    if (sourceLessonId !== target.id && target._count.steps === 0) {
      const legacyStep = await tx.lessonStep.create({
        data: {
          lessonId: target.id,
          title: "Материал",
          order: 0,
          contentMd: target.contentMd,
          readingMinutes: computeReadingMinutes(target.contentMd),
        },
      });
      await writeAudit(tx, {
        actorId: input.actorId,
        action: "lesson.steps_enabled",
        entityType: "lesson",
        entityId: target.id,
        after: { firstStepId: legacyStep.id, via: "step_move" },
      });
    }
    const destination =
      sourceLessonId === target.id
        ? source
        : await tx.lessonStep.findMany({
            where: { lessonId: target.id },
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            select: { id: true },
          });
    const index = Math.max(0, Math.min(input.targetIndex, destination.length));
    const ordered = destination.map((item) => item.id);
    ordered.splice(index, 0, step.id);
    await parkStepOrders(tx, [...new Set([...source.map((item) => item.id), ...ordered])]);
    for (const [order, id] of source.entries()) {
      if (sourceLessonId !== target.id)
        await tx.lessonStep.update({ where: { id: id.id }, data: { order } });
    }
    for (const [order, id] of ordered.entries()) {
      await tx.lessonStep.update({ where: { id }, data: { lessonId: target.id, order } });
    }
    if (sourceLessonId !== target.id) {
      await tx.questionLesson.updateMany({
        where: { stepId: step.id },
        data: { lessonId: target.id },
      });
    }
    await syncLessonAggregate(tx, sourceLessonId);
    if (target.id !== sourceLessonId) await syncLessonAggregate(tx, target.id);
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "lesson_step.moved",
      entityType: "lesson_step",
      entityId: step.id,
      before: { lessonId: sourceLessonId },
      after: { lessonId: target.id, order: index },
    });
  });
}

export async function deleteLessonStep(
  db: PrismaClient,
  input: { actorId: string; stepId: string },
): Promise<
  | {
      ok: true;
      lessonId: string;
      deletedProgressCount: number;
      detachedQuestionCount: number;
    }
  | { ok: false; code: "not_found" | "last_step" }
> {
  return db.$transaction(async (tx) => {
    const step = await tx.lessonStep.findUnique({
      where: { id: input.stepId },
      include: { _count: { select: { progress: true, questionLinks: true } } },
    });
    if (!step) return { ok: false, code: "not_found" } as const;
    const count = await tx.lessonStep.count({ where: { lessonId: step.lessonId } });
    if (count <= 1) return { ok: false, code: "last_step" } as const;
    const deletedProgressCount = step._count.progress;
    const detachedQuestionCount = step._count.questionLinks;
    await tx.lessonStep.delete({ where: { id: step.id } });
    const rest = await tx.lessonStep.findMany({
      where: { lessonId: step.lessonId },
      orderBy: { order: "asc" },
    });
    await parkStepOrders(
      tx,
      rest.map((item) => item.id),
    );
    for (const [order, item] of rest.entries())
      await tx.lessonStep.update({ where: { id: item.id }, data: { order } });
    await syncLessonAggregate(tx, step.lessonId);
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "lesson_step.deleted",
      entityType: "lesson_step",
      entityId: step.id,
      before: {
        lessonId: step.lessonId,
        title: step.title,
        deletedProgressCount,
        detachedQuestionCount,
      },
    });
    return {
      ok: true,
      lessonId: step.lessonId,
      deletedProgressCount,
      detachedQuestionCount,
    } as const;
  });
}

export async function completeLessonStep(
  db: PrismaClient,
  input: { userId: string; lessonId: string; stepId: string; now?: Date },
): Promise<
  | { ok: true; nextStepId: string | null; lessonCompleted: boolean }
  | {
      ok: false;
      code: "not_found" | "locked" | "course_locked" | "path_required" | "previous_step_required";
    }
> {
  const now = input.now ?? new Date();
  const view = await getLessonView(db, input.lessonId, input.userId);
  if (!view) return { ok: false, code: "not_found" };
  if (!view.unlocked) return { ok: false, code: "locked" };
  const steps = await db.lessonStep.findMany({
    where: { lessonId: input.lessonId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  const index = steps.findIndex((step) => step.id === input.stepId);
  if (index < 0) return { ok: false, code: "not_found" };
  if (index > 0) {
    const previousCompleted = await db.lessonStepProgress.count({
      where: {
        userId: input.userId,
        stepId: { in: steps.slice(0, index).map((step) => step.id) },
        status: "completed",
      },
    });
    if (previousCompleted !== index) return { ok: false, code: "previous_step_required" };
  }
  const nextStepId = steps[index + 1]?.id ?? null;
  if (!nextStepId) {
    const completed = await completeLesson(db, {
      userId: input.userId,
      lessonId: input.lessonId,
      now,
    });
    if (!completed.ok) return completed;
  }
  await db.lessonStepProgress.upsert({
    where: { userId_stepId: { userId: input.userId, stepId: input.stepId } },
    create: { userId: input.userId, stepId: input.stepId, status: "completed", completedAt: now },
    update: { status: "completed", completedAt: now },
  });
  if (nextStepId) return { ok: true, nextStepId, lessonCompleted: false };
  return { ok: true, nextStepId: null, lessonCompleted: true };
}

export async function saveLessonStepPosition(
  db: Db,
  input: { userId: string; stepId: string; scrollPos: number },
): Promise<void> {
  const scrollPos = Math.max(0, Math.min(1, input.scrollPos));
  await db.lessonStepProgress.upsert({
    where: { userId_stepId: { userId: input.userId, stepId: input.stepId } },
    create: { userId: input.userId, stepId: input.stepId, status: "in_progress", scrollPos },
    update: { scrollPos },
  });
}
