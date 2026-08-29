"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  copyLesson,
  createCourse,
  createLesson,
  createModule,
  deleteCourse,
  deleteLesson,
  deleteModule,
  publishLessonsInScope,
  unpublishLessonsInScope,
  renameModule,
  reorderSiblings,
  saveLessonContent,
  setCourseStatus,
  setLessonStatus,
  setModuleStatus,
  updateCourse,
  updateLessonMeta,
  moveLessonToModule,
} from "@/lib/services/content-admin";
import {
  copyLessonAsStep,
  copyLessonsAsSteps,
  createLessonStep,
  deleteLessonStep,
  moveLessonStep,
  renameLessonStep,
  saveLessonStep,
  setLessonStepStatus,
  splitLessonIntoSteps,
} from "@/lib/services/lesson-steps";
import {
  ActionError,
  parseInput,
  requireActionPermission,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";

// Content studio actions — mentor+ (spec 2: создавать/редактировать контент).

const titleSchema = z
  .string("Укажи название")
  .trim()
  .min(1, "Укажи название")
  .max(200, "Слишком длинное название");
const idSchema = z.string().min(1);
const slugSchema = z
  .string("Укажи slug")
  .trim()
  .regex(/^[a-z0-9-]{1,60}$/, "Адрес — латиница, цифры и дефисы");
const statusSchema = z.enum(["draft", "published"]);
const optionalMinutesSchema = z
  .union([z.literal(""), z.coerce.number().int().min(1).max(1440)])
  .transform((value) => (value === "" ? null : value));

const stepMoveSchema = z.object({
  stepId: idSchema,
  targetLessonId: idSchema,
  targetIndex: z.coerce.number().int().min(0).max(500),
});

const lessonCopySchema = z.object({
  sourceLessonId: idSchema,
  targetModuleId: idSchema,
  title: titleSchema,
});

const lessonAsStepSchema = z.object({
  sourceLessonId: idSchema,
  targetLessonId: idSchema,
  title: titleSchema,
});

const lessonsAsStepsSchema = z.object({
  targetLessonId: idSchema,
  sources: z
    .array(z.object({ sourceLessonId: idSchema, title: titleSchema }))
    .min(1, "Выбери хотя бы один урок")
    .max(100, "За один раз можно добавить не больше 100 уроков")
    .refine(
      (sources) => new Set(sources.map((source) => source.sourceLessonId)).size === sources.length,
      "Один урок выбран несколько раз",
    ),
});

const courseUpdateSchema = z.object({
  courseId: idSchema,
  title: titleSchema,
  slug: slugSchema,
  description: z.string().trim().max(1000, "Слишком длинное описание"),
  gating: z.enum(["strict", "recommended", "free"]),
  /**
   * Категории банка вопросов, относящиеся к курсу (заход «Банк вопросов»).
   * Поле необязательное: формы, которые его не шлют, связь не трогают.
   */
  questionCategoryIds: z.array(idSchema).max(300).optional(),
});

const lessonMetaSchema = z.object({
  lessonId: idSchema,
  title: titleSchema,
  slug: slugSchema,
  videoUrl: z
    .union([z.literal(""), z.url("Некорректная ссылка на видео")])
    .transform((value) => value || null),
  difficulty: z.enum(["intro", "base", "advanced"]),
  isOptional: z.boolean(),
  pathPolicy: z.enum(["combined", "choose_one", "video_only", "text_only"]),
  textMinutes: optionalMinutesSchema,
  videoMinutes: optionalMinutesSchema,
  practiceMinutes: optionalMinutesSchema,
});

const reorderSchema = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("courses") }),
    z.object({ kind: z.literal("modules"), courseId: idSchema }),
    z.object({ kind: z.literal("lessons"), moduleId: idSchema }),
  ]),
  orderedIds: z.array(idSchema).min(1).max(500),
});

function failWith(res: { ok: false; code: string }): never {
  const messages: Record<string, string> = {
    not_found: "Элемент не найден",
    slug_taken: "Такой адрес уже занят",
    not_draft: "Удалять можно только черновики — сначала сними с публикации",
    has_student_data:
      "Нельзя удалить: есть история учеников (прогресс, ответы, попытки). Так безопаснее — данные сохранены.",
    invalid_learning_path:
      "Для выбранного пути нужны соответствующие материалы: видео и/или текст урока",
    unsafe_recording_reference:
      "Прямую ссылку или пароль от записи интервью публиковать нельзя. Добавь запись в Библиотеку и пройди чеклист 4/4.",
    last_step: "В уроке должен остаться хотя бы один шаг",
    question_conflict:
      "В целевом уроке уже есть один из вопросов этого шага — сначала убери дублирующую привязку",
    same_lesson: "Нельзя добавить урок как шаг самого в себя — выбери другой исходный урок",
    duplicate_source: "Один исходный урок выбран несколько раз",
    empty_content: "Нельзя опубликовать пустой шаг — сначала добавь материал",
    last_published_step: "В опубликованном уроке должен остаться хотя бы один опубликованный шаг",
  };
  throw new ActionError(res.code, messages[res.code] ?? "Не получилось выполнить действие");
}

export async function splitLessonIntoStepsAction(
  lessonId: string,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const result = await splitLessonIntoSteps(prisma, {
      actorId: auth.user.id,
      lessonId: parseInput(idSchema, lessonId),
    });
    revalidateContent(undefined, lessonId);
    revalidatePath(`/admin/content/lessons/${lessonId}`);
    return result;
  });
}

export async function createLessonStepAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(z.object({ lessonId: idSchema, title: titleSchema }), input);
    const result = await createLessonStep(prisma, { actorId: auth.user.id, ...parsed });
    revalidateContent(undefined, parsed.lessonId);
    revalidatePath(`/admin/content/lessons/${parsed.lessonId}`);
    return result;
  });
}

export async function copyLessonAsStepAction(input: unknown): Promise<
  ActionResult<{
    id: string;
    copiedQuestionCount: number;
    skippedQuestionCount: number;
    recordingNotice: boolean;
  }>
> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(lessonAsStepSchema, input);
    const result = await copyLessonAsStep(prisma, { actorId: auth.user.id, ...parsed });
    if (!result.ok) failWith(result);
    revalidateContent(undefined, parsed.targetLessonId);
    revalidatePath(`/admin/content/lessons/${parsed.targetLessonId}`);
    return {
      id: result.id,
      copiedQuestionCount: result.copiedQuestionCount,
      skippedQuestionCount: result.skippedQuestionCount,
      recordingNotice: result.recordingNotice,
    };
  });
}

export async function copyLessonsAsStepsAction(input: unknown): Promise<
  ActionResult<{
    ids: string[];
    copiedQuestionCount: number;
    skippedQuestionCount: number;
    recordingNotice: boolean;
  }>
> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(lessonsAsStepsSchema, input);
    const result = await copyLessonsAsSteps(prisma, { actorId: auth.user.id, ...parsed });
    if (!result.ok) failWith(result);
    revalidateContent(undefined, parsed.targetLessonId);
    revalidatePath(`/admin/content/lessons/${parsed.targetLessonId}`);
    return {
      ids: result.ids,
      copiedQuestionCount: result.copiedQuestionCount,
      skippedQuestionCount: result.skippedQuestionCount,
      recordingNotice: result.recordingNotice,
    };
  });
}

export async function saveLessonStepContentAction(
  stepId: string,
  contentMd: string,
): Promise<ActionResult<{ readingMinutes: number; recordingNotice: boolean }>> {
  return runAction(async () => {
    await requireActionPermission("content.manage");
    const markdown = parseInput(z.string().max(300_000, "Слишком большой документ"), contentMd);
    const result = await saveLessonStep(prisma, {
      stepId: parseInput(idSchema, stepId),
      contentMd: markdown,
    });
    if (!result.ok) failWith(result);
    revalidatePath(`/lessons/${result.lessonId}`);
    return {
      readingMinutes: Math.max(
        1,
        Math.ceil(markdown.trim().split(/\s+/).filter(Boolean).length / 200),
      ),
      recordingNotice: result.recordingNotice,
    };
  });
}

export async function renameLessonStepAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(z.object({ stepId: idSchema, title: titleSchema }), input);
    const result = await renameLessonStep(prisma, { actorId: auth.user.id, ...parsed });
    if (!result) throw new ActionError("not_found", "Шаг не найден");
    revalidateContent(undefined, result.lessonId);
    revalidatePath(`/admin/content/lessons/${result.lessonId}`);
  });
}

export async function setLessonStepStatusAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(z.object({ stepId: idSchema, status: statusSchema }), input);
    const result = await setLessonStepStatus(prisma, { actorId: auth.user.id, ...parsed });
    if (!result.ok) failWith(result);
    revalidateContent(undefined, result.lessonId);
    revalidatePath(`/admin/content/lessons/${result.lessonId}`);
  });
}

export async function moveLessonStepAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(stepMoveSchema, input);
    try {
      await moveLessonStep(prisma, { actorId: auth.user.id, ...parsed });
    } catch (error) {
      if (error instanceof Error && error.message === "last_step")
        failWith({ ok: false, code: "last_step" });
      if (error instanceof Error && error.message === "last_published_step")
        failWith({ ok: false, code: "last_published_step" });
      if (error instanceof Error && error.message === "question_conflict") {
        failWith({ ok: false, code: "question_conflict" });
      }
      throw error;
    }
    revalidateContent();
  });
}

export async function deleteLessonStepAction(
  stepId: string,
): Promise<ActionResult<{ deletedProgressCount: number; detachedQuestionCount: number }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const result = await deleteLessonStep(prisma, {
      actorId: auth.user.id,
      stepId: parseInput(idSchema, stepId),
    });
    if (!result.ok) failWith(result);
    revalidateContent(undefined, result.lessonId);
    revalidatePath(`/admin/content/lessons/${result.lessonId}`);
    return {
      deletedProgressCount: result.deletedProgressCount,
      detachedQuestionCount: result.detachedQuestionCount,
    };
  });
}

export async function moveLessonToModuleAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(z.object({ lessonId: idSchema, targetModuleId: idSchema }), input);
    const result = await moveLessonToModule(prisma, { actorId: auth.user.id, ...parsed });
    if (!result.ok) failWith(result);
    revalidateContent();
    revalidatePath(`/admin/content/lessons/${parsed.lessonId}`);
  });
}

/** Publication must be visible to students immediately (spec 12: on-demand revalidate). */
function revalidateContent(courseSlug?: string, lessonId?: string): void {
  revalidatePath("/admin/content");
  revalidatePath("/courses");
  if (courseSlug) revalidatePath(`/courses/${courseSlug}`);
  if (lessonId) revalidatePath(`/lessons/${lessonId}`);
}

export async function createCourseAction(title: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(titleSchema, title);
    const created = await createCourse(prisma, { actorId: auth.user.id, title: parsed });
    revalidateContent();
    return created;
  });
}

export async function updateCourseAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(courseUpdateSchema, input);
    const res = await updateCourse(prisma, {
      actorId: auth.user.id,
      courseId: parsed.courseId,
      data: {
        title: parsed.title,
        slug: parsed.slug,
        description: parsed.description,
        gating: parsed.gating,
        questionCategoryIds: parsed.questionCategoryIds,
      },
    });
    if (!res.ok) failWith(res);
    revalidateContent(parsed.slug);
    // Связь курс↔категории решает, что ученик видит в банке.
    revalidatePath("/questions");
    return undefined;
  });
}

export async function setCourseStatusAction(
  courseId: string,
  status: "draft" | "published",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await setCourseStatus(prisma, {
      actorId: auth.user.id,
      courseId: parseInput(idSchema, courseId),
      status: parseInput(statusSchema, status),
    });
    if (!res.ok) failWith(res);
    revalidateContent(res.slug);
    return undefined;
  });
}

export async function deleteCourseAction(courseId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await deleteCourse(prisma, {
      actorId: auth.user.id,
      courseId: parseInput(idSchema, courseId),
    });
    if (!res.ok) failWith(res);
    revalidateContent();
    return undefined;
  });
}

export async function createModuleAction(
  courseId: string,
  title: string,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const created = await createModule(prisma, {
      actorId: auth.user.id,
      courseId: parseInput(idSchema, courseId),
      title: parseInput(titleSchema, title),
    });
    if (!created) throw new ActionError("not_found", "Курс не найден");
    revalidateContent();
    return created;
  });
}

export async function renameModuleAction(
  moduleId: string,
  title: string,
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await renameModule(prisma, {
      actorId: auth.user.id,
      moduleId: parseInput(idSchema, moduleId),
      title: parseInput(titleSchema, title),
    });
    if (!res.ok) failWith(res);
    revalidateContent();
    return undefined;
  });
}

export async function setModuleStatusAction(
  moduleId: string,
  status: "draft" | "published",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await setModuleStatus(prisma, {
      actorId: auth.user.id,
      moduleId: parseInput(idSchema, moduleId),
      status: parseInput(statusSchema, status),
    });
    if (!res.ok) failWith(res);
    revalidateContent();
    return undefined;
  });
}

export async function deleteModuleAction(moduleId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await deleteModule(prisma, {
      actorId: auth.user.id,
      moduleId: parseInput(idSchema, moduleId),
    });
    if (!res.ok) failWith(res);
    revalidateContent();
    return undefined;
  });
}

export async function createLessonAction(
  moduleId: string,
  title: string,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const created = await createLesson(prisma, {
      actorId: auth.user.id,
      moduleId: parseInput(idSchema, moduleId),
      title: parseInput(titleSchema, title),
    });
    if (!created) throw new ActionError("not_found", "Модуль не найден");
    revalidateContent();
    return created;
  });
}

export async function copyLessonAction(
  input: unknown,
): Promise<ActionResult<{ id: string; copiedStepCount: number; copiedQuestionCount: number }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(lessonCopySchema, input);
    const copied = await copyLesson(prisma, { actorId: auth.user.id, ...parsed });
    if (!copied) throw new ActionError("not_found", "Исходный урок или целевой модуль не найден");
    revalidateContent();
    revalidatePath(`/admin/content/lessons/${copied.id}`);
    return copied;
  });
}

/** Editor autosave — no audit (see service DECISION), no revalidate churn. */
export async function saveLessonContentAction(
  lessonId: string,
  contentMd: string,
): Promise<ActionResult<{ readingMinutes: number; recordingNotice: boolean }>> {
  return runAction(async () => {
    await requireActionPermission("content.manage");
    const res = await saveLessonContent(prisma, {
      lessonId: parseInput(idSchema, lessonId),
      contentMd: parseInput(z.string().max(300_000, "Слишком большой документ"), contentMd),
    });
    if (!res.ok) failWith(res);
    // `recordingNotice` — не ошибка, а последствие: сохранено, но ученик увидит
    // врезку про Библиотеку вместо ссылки (заход C.4).
    return {
      readingMinutes: res.readingMinutes ?? 1,
      recordingNotice: res.recordingNotice ?? false,
    };
  });
}

export async function updateLessonMetaAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(lessonMetaSchema, input);
    const res = await updateLessonMeta(prisma, {
      actorId: auth.user.id,
      lessonId: parsed.lessonId,
      data: {
        title: parsed.title,
        slug: parsed.slug,
        videoUrl: parsed.videoUrl,
        difficulty: parsed.difficulty,
        isOptional: parsed.isOptional,
        pathPolicy: parsed.pathPolicy,
        textMinutes: parsed.textMinutes,
        videoMinutes: parsed.videoMinutes,
        practiceMinutes: parsed.practiceMinutes,
      },
    });
    if (!res.ok) failWith(res);
    revalidateContent(undefined, parsed.lessonId);
    revalidatePath(`/admin/content/lessons/${parsed.lessonId}`);
    return undefined;
  });
}

export async function setLessonStatusAction(
  lessonId: string,
  status: "draft" | "published",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await setLessonStatus(prisma, {
      actorId: auth.user.id,
      lessonId: parseInput(idSchema, lessonId),
      status: parseInput(statusSchema, status),
    });
    if (!res.ok) failWith(res);
    revalidateContent(res.courseSlug, lessonId);
    revalidatePath(`/admin/content/lessons/${lessonId}`);
    return undefined;
  });
}

const publishLessonsScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("module"), moduleId: idSchema }),
  z.object({ kind: z.literal("course"), courseId: idSchema }),
]);

/** Bulk-publish valid draft lessons under a module/course (spec 8.5). */
export async function publishLessonsAction(
  input: unknown,
): Promise<ActionResult<{ published: number; skipped: number }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(publishLessonsScopeSchema, input);
    const res = await publishLessonsInScope(prisma, { actorId: auth.user.id, scope: parsed });
    if (!res.ok) failWith(res);
    revalidateContent(res.courseSlug);
    return { published: res.published, skipped: res.skipped };
  });
}

/** Bulk-«в черновик» every published lesson under a module/course (spec 13.1/C4). */
export async function unpublishLessonsAction(
  input: unknown,
): Promise<ActionResult<{ unpublished: number }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(publishLessonsScopeSchema, input);
    const res = await unpublishLessonsInScope(prisma, { actorId: auth.user.id, scope: parsed });
    if (!res.ok) failWith(res);
    revalidateContent(res.courseSlug);
    return { unpublished: res.unpublished };
  });
}

export async function deleteLessonAction(lessonId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await deleteLesson(prisma, {
      actorId: auth.user.id,
      lessonId: parseInput(idSchema, lessonId),
    });
    if (!res.ok) failWith(res);
    revalidateContent();
    return undefined;
  });
}

export async function reorderContentAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(reorderSchema, input);
    await reorderSiblings(prisma, {
      actorId: auth.user.id,
      scope: parsed.scope,
      orderedIds: parsed.orderedIds,
    });
    revalidateContent();
    return undefined;
  });
}
