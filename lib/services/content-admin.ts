import type { ContentStatus, CourseGating, LessonDifficulty, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";
import { computeReadingMinutes } from "@/lib/utils/markdown";
import { slugify, uniqueSlug } from "@/lib/utils/slug";

// Admin content studio (spec 8.5 /admin/content).
// DECISION: split from content.ts for readability — same «content» service
// domain as section 4 lists it, one file per side of the counter.

// --- Tree ---

export async function getContentTree(db: Db) {
  return db.course.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: {
      modules: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: {
          lessons: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              title: true,
              status: true,
              isOptional: true,
              readingMinutes: true,
            },
          },
        },
      },
    },
  });
}

// --- Courses ---

export async function createCourse(
  db: PrismaClient,
  input: { actorId: string; title: string },
): Promise<{ id: string }> {
  const slug = await uniqueSlug(
    slugify(input.title),
    async (candidate) => (await db.course.findUnique({ where: { slug: candidate } })) !== null,
  );
  const last = await db.course.findFirst({ orderBy: { order: "desc" }, select: { order: true } });
  const course = await db.course.create({
    data: { title: input.title, slug, order: (last?.order ?? -1) + 1 },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "course.created",
    entityType: "course",
    entityId: course.id,
    after: { title: input.title, slug },
  });
  return { id: course.id };
}

export type AdminContentResult =
  { ok: true } | { ok: false; code: "not_found" | "slug_taken" | "not_draft" };

export async function updateCourse(
  db: PrismaClient,
  input: {
    actorId: string;
    courseId: string;
    data: { title: string; slug: string; description: string; gating: CourseGating };
  },
): Promise<AdminContentResult> {
  const course = await db.course.findUnique({ where: { id: input.courseId } });
  if (!course) return { ok: false, code: "not_found" };
  const slugOwner = await db.course.findUnique({ where: { slug: input.data.slug } });
  if (slugOwner && slugOwner.id !== course.id) return { ok: false, code: "slug_taken" };

  await db.course.update({ where: { id: course.id }, data: input.data });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "course.updated",
    entityType: "course",
    entityId: course.id,
    before: {
      title: course.title,
      slug: course.slug,
      description: course.description,
      gating: course.gating,
    },
    after: { ...input.data },
  });
  return { ok: true };
}

export async function setCourseStatus(
  db: PrismaClient,
  input: { actorId: string; courseId: string; status: ContentStatus },
): Promise<AdminContentResult & { slug?: string }> {
  const course = await db.course.findUnique({ where: { id: input.courseId } });
  if (!course) return { ok: false, code: "not_found" };
  await db.course.update({ where: { id: course.id }, data: { status: input.status } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: input.status === "published" ? "course.published" : "course.unpublished",
    entityType: "course",
    entityId: course.id,
    before: { status: course.status },
    after: { status: input.status },
  });
  return { ok: true, slug: course.slug };
}

/** DECISION: deletion is draft-only — published content may carry student progress. */
export async function deleteCourse(
  db: PrismaClient,
  input: { actorId: string; courseId: string },
): Promise<AdminContentResult> {
  const course = await db.course.findUnique({ where: { id: input.courseId } });
  if (!course) return { ok: false, code: "not_found" };
  if (course.status !== "draft") return { ok: false, code: "not_draft" };
  await db.course.delete({ where: { id: course.id } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "course.deleted",
    entityType: "course",
    entityId: course.id,
    before: { title: course.title, slug: course.slug },
  });
  return { ok: true };
}

// --- Modules ---

export async function createModule(
  db: PrismaClient,
  input: { actorId: string; courseId: string; title: string },
): Promise<{ id: string } | null> {
  const course = await db.course.findUnique({ where: { id: input.courseId } });
  if (!course) return null;
  const last = await db.module.findFirst({
    where: { courseId: course.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const mod = await db.module.create({
    data: { courseId: course.id, title: input.title, order: (last?.order ?? -1) + 1 },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "module.created",
    entityType: "module",
    entityId: mod.id,
    after: { title: input.title, courseId: course.id },
  });
  return { id: mod.id };
}

export async function renameModule(
  db: PrismaClient,
  input: { actorId: string; moduleId: string; title: string },
): Promise<AdminContentResult> {
  const mod = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!mod) return { ok: false, code: "not_found" };
  await db.module.update({ where: { id: mod.id }, data: { title: input.title } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "module.updated",
    entityType: "module",
    entityId: mod.id,
    before: { title: mod.title },
    after: { title: input.title },
  });
  return { ok: true };
}

export async function setModuleStatus(
  db: PrismaClient,
  input: { actorId: string; moduleId: string; status: ContentStatus },
): Promise<AdminContentResult> {
  const mod = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!mod) return { ok: false, code: "not_found" };
  await db.module.update({ where: { id: mod.id }, data: { status: input.status } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: input.status === "published" ? "module.published" : "module.unpublished",
    entityType: "module",
    entityId: mod.id,
    before: { status: mod.status },
    after: { status: input.status },
  });
  return { ok: true };
}

export async function deleteModule(
  db: PrismaClient,
  input: { actorId: string; moduleId: string },
): Promise<AdminContentResult> {
  const mod = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!mod) return { ok: false, code: "not_found" };
  if (mod.status !== "draft") return { ok: false, code: "not_draft" };
  await db.module.delete({ where: { id: mod.id } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "module.deleted",
    entityType: "module",
    entityId: mod.id,
    before: { title: mod.title },
  });
  return { ok: true };
}

// --- Lessons ---

export async function createLesson(
  db: PrismaClient,
  input: { actorId: string; moduleId: string; title: string },
): Promise<{ id: string } | null> {
  const mod = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!mod) return null;
  const slug = await uniqueSlug(
    slugify(input.title),
    async (candidate) =>
      (await db.lesson.findUnique({
        where: { moduleId_slug: { moduleId: mod.id, slug: candidate } },
      })) !== null,
  );
  const last = await db.lesson.findFirst({
    where: { moduleId: mod.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const lesson = await db.lesson.create({
    data: { moduleId: mod.id, title: input.title, slug, order: (last?.order ?? -1) + 1 },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "lesson.created",
    entityType: "lesson",
    entityId: lesson.id,
    after: { title: input.title, moduleId: mod.id },
  });
  return { id: lesson.id };
}

export async function getLessonForEditor(db: Db, lessonId: string) {
  return db.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { include: { course: { select: { id: true, title: true, slug: true } } } } },
  });
}

/**
 * Editor autosave: content only. reading_minutes recomputed on save (spec 6);
 * content_updated_at bumps only when the markdown actually changed («урок
 * обновлён»). DECISION: autosaves are not audited (a keystroke-level log is
 * noise) — metadata changes and publish/unpublish are.
 */
export async function saveLessonContent(
  db: PrismaClient,
  input: { lessonId: string; contentMd: string; now?: Date },
): Promise<AdminContentResult & { readingMinutes?: number }> {
  const now = input.now ?? new Date();
  const lesson = await db.lesson.findUnique({ where: { id: input.lessonId } });
  if (!lesson) return { ok: false, code: "not_found" };

  const changed = lesson.contentMd !== input.contentMd;
  const readingMinutes = computeReadingMinutes(input.contentMd);
  if (changed) {
    await db.lesson.update({
      where: { id: lesson.id },
      data: { contentMd: input.contentMd, readingMinutes, contentUpdatedAt: now },
    });
  }
  return { ok: true, readingMinutes };
}

export async function updateLessonMeta(
  db: PrismaClient,
  input: {
    actorId: string;
    lessonId: string;
    data: {
      title: string;
      slug: string;
      videoUrl: string | null;
      difficulty: LessonDifficulty;
      isOptional: boolean;
    };
  },
): Promise<AdminContentResult> {
  const lesson = await db.lesson.findUnique({ where: { id: input.lessonId } });
  if (!lesson) return { ok: false, code: "not_found" };
  const slugOwner = await db.lesson.findUnique({
    where: { moduleId_slug: { moduleId: lesson.moduleId, slug: input.data.slug } },
  });
  if (slugOwner && slugOwner.id !== lesson.id) return { ok: false, code: "slug_taken" };

  await db.lesson.update({
    where: { id: lesson.id },
    data: {
      ...input.data,
      // A new video link needs the stage-9 monitor to re-check it.
      ...(input.data.videoUrl !== lesson.videoUrl
        ? { videoStatus: "unchecked", videoCheckedAt: null }
        : {}),
    },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "lesson.updated",
    entityType: "lesson",
    entityId: lesson.id,
    before: {
      title: lesson.title,
      slug: lesson.slug,
      videoUrl: lesson.videoUrl,
      difficulty: lesson.difficulty,
      isOptional: lesson.isOptional,
    },
    after: { ...input.data },
  });
  return { ok: true };
}

export async function setLessonStatus(
  db: PrismaClient,
  input: { actorId: string; lessonId: string; status: ContentStatus; now?: Date },
): Promise<AdminContentResult & { courseSlug?: string }> {
  const now = input.now ?? new Date();
  const lesson = await db.lesson.findUnique({
    where: { id: input.lessonId },
    include: { module: { include: { course: { select: { slug: true } } } } },
  });
  if (!lesson) return { ok: false, code: "not_found" };

  await db.lesson.update({
    where: { id: lesson.id },
    data: {
      status: input.status,
      ...(input.status === "published" && lesson.publishedAt === null ? { publishedAt: now } : {}),
    },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: input.status === "published" ? "lesson.published" : "lesson.unpublished",
    entityType: "lesson",
    entityId: lesson.id,
    before: { status: lesson.status },
    after: { status: input.status },
  });
  return { ok: true, courseSlug: lesson.module.course.slug };
}

export async function deleteLesson(
  db: PrismaClient,
  input: { actorId: string; lessonId: string },
): Promise<AdminContentResult> {
  const lesson = await db.lesson.findUnique({ where: { id: input.lessonId } });
  if (!lesson) return { ok: false, code: "not_found" };
  if (lesson.status !== "draft") return { ok: false, code: "not_draft" };
  await db.lesson.delete({ where: { id: lesson.id } });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "lesson.deleted",
    entityType: "lesson",
    entityId: lesson.id,
    before: { title: lesson.title },
  });
  return { ok: true };
}

// --- Reorder (drag in the tree) ---

type ReorderScope =
  | { kind: "courses" }
  | { kind: "modules"; courseId: string }
  | { kind: "lessons"; moduleId: string };

/** Persists a sibling order after a drag; ids outside the scope are ignored. */
export async function reorderSiblings(
  db: PrismaClient,
  input: { actorId: string; scope: ReorderScope; orderedIds: string[] },
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const [index, id] of input.orderedIds.entries()) {
      if (input.scope.kind === "courses") {
        await tx.course.updateMany({ where: { id }, data: { order: index } });
      } else if (input.scope.kind === "modules") {
        await tx.module.updateMany({
          where: { id, courseId: input.scope.courseId },
          data: { order: index },
        });
      } else {
        await tx.lesson.updateMany({
          where: { id, moduleId: input.scope.moduleId },
          data: { order: index },
        });
      }
    }
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "content.reordered",
      entityType: input.scope.kind,
      entityId:
        input.scope.kind === "courses"
          ? "root"
          : input.scope.kind === "modules"
            ? input.scope.courseId
            : input.scope.moduleId,
      after: { orderedIds: input.orderedIds },
    });
  });
}
