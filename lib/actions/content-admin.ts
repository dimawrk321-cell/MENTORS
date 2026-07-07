"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createCourse,
  createLesson,
  createModule,
  deleteCourse,
  deleteLesson,
  deleteModule,
  renameModule,
  reorderSiblings,
  saveLessonContent,
  setCourseStatus,
  setLessonStatus,
  setModuleStatus,
  updateCourse,
  updateLessonMeta,
} from "@/lib/services/content-admin";
import {
  ActionError,
  parseInput,
  requireActionRole,
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
  .regex(/^[a-z0-9-]{1,60}$/, "Slug — латиница, цифры и дефисы");
const statusSchema = z.enum(["draft", "published"]);

const courseUpdateSchema = z.object({
  courseId: idSchema,
  title: titleSchema,
  slug: slugSchema,
  description: z.string().trim().max(1000, "Слишком длинное описание"),
  gating: z.enum(["strict", "recommended", "free"]),
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
    slug_taken: "Такой slug уже занят",
    not_draft: "Удалять можно только черновики — сначала сними с публикации",
  };
  throw new ActionError(res.code, messages[res.code] ?? "Не получилось выполнить действие");
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
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(titleSchema, title);
    const created = await createCourse(prisma, { actorId: auth.user.id, title: parsed });
    revalidateContent();
    return created;
  });
}

export async function updateCourseAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
    const parsed = parseInput(courseUpdateSchema, input);
    const res = await updateCourse(prisma, {
      actorId: auth.user.id,
      courseId: parsed.courseId,
      data: {
        title: parsed.title,
        slug: parsed.slug,
        description: parsed.description,
        gating: parsed.gating,
      },
    });
    if (!res.ok) failWith(res);
    revalidateContent(parsed.slug);
    return undefined;
  });
}

export async function setCourseStatusAction(
  courseId: string,
  status: "draft" | "published",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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

/** Editor autosave — no audit (see service DECISION), no revalidate churn. */
export async function saveLessonContentAction(
  lessonId: string,
  contentMd: string,
): Promise<ActionResult<{ readingMinutes: number }>> {
  return runAction(async () => {
    await requireActionRole("mentor");
    const res = await saveLessonContent(prisma, {
      lessonId: parseInput(idSchema, lessonId),
      contentMd: parseInput(z.string().max(300_000, "Слишком большой документ"), contentMd),
    });
    if (!res.ok) failWith(res);
    return { readingMinutes: res.readingMinutes ?? 1 };
  });
}

export async function updateLessonMetaAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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

export async function deleteLessonAction(lessonId: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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
