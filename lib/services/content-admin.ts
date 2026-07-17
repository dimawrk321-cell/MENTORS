import type { ContentStatus, CourseGating, LessonDifficulty, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";
import { notify } from "@/lib/services/notifications";
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
          test: true,
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

// --- Stage 9: lesson notification triggers (spec 7.12/task) ---

/**
 * lesson_new (spec 7.12): on the FIRST publish of a lesson whose module AND
 * course are already published, notify every active student. Fires only from
 * the single-lesson publish (adding a lesson to a live course — acceptance flow
 * 9); the bulk imported-draft publish runs while the course is still draft, so
 * the course-published guard keeps it silent. DECISION: bulk publish does not
 * emit lesson_new (would flood on the 64-draft review).
 */
export async function notifyLessonPublished(
  db: PrismaClient,
  lessonId: string,
  now: Date = new Date(),
): Promise<void> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: { select: { status: true, course: { select: { title: true, status: true } } } },
    },
  });
  if (!lesson || lesson.status !== "published") return;
  if (lesson.module.status !== "published" || lesson.module.course.status !== "published") return;

  const students = await db.user.findMany({
    where: { role: "student", status: "active" },
    select: { id: true },
  });
  for (const student of students) {
    await notify(
      db,
      student.id,
      "lesson_new",
      { lessonId: lesson.id, lessonTitle: lesson.title, courseTitle: lesson.module.course.title },
      { now },
    );
  }
}

/**
 * lesson_updated (spec 7.12): when a PUBLISHED lesson's content bumps, notify
 * students who already completed it. Guarded on published (draft edits — the
 * common case — stay silent) and deduped on the unread notification so autosave
 * bursts collapse into one pending «урок обновлён» per student until they read it.
 */
export async function notifyLessonUpdated(
  db: PrismaClient,
  lessonId: string,
  now: Date = new Date(),
): Promise<void> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, title: true, status: true },
  });
  if (!lesson || lesson.status !== "published") return;

  const completers = await db.lessonProgress.findMany({
    where: { lessonId, status: "completed" },
    select: { userId: true },
  });
  const url = `/lessons/${lessonId}`;
  for (const completer of completers) {
    const pending = await db.notification.count({
      where: { userId: completer.userId, type: "lesson_updated", url, inApp: true, readAt: null },
    });
    if (pending > 0) continue;
    await notify(
      db,
      completer.userId,
      "lesson_updated",
      { lessonId: lesson.id, lessonTitle: lesson.title },
      { now },
    );
  }
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
    // Published lesson edited → notify completers («урок обновлён», spec 7.12).
    // No-op for drafts (the common editing case) via the published guard inside.
    await notifyLessonUpdated(db, lesson.id, now);
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

  const firstPublish = input.status === "published" && lesson.publishedAt === null;
  await db.lesson.update({
    where: { id: lesson.id },
    data: {
      status: input.status,
      ...(firstPublish ? { publishedAt: now } : {}),
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
  // New lesson going live in a published course → lesson_new (spec 7.12).
  if (firstPublish) {
    await notifyLessonPublished(db, lesson.id, now);
  }
  return { ok: true, courseSlug: lesson.module.course.slug };
}

/**
 * A draft lesson is publishable only if it has actual content — an empty
 * imported stub (title only) must not go live. Cheap, pure gate so the bulk
 * action can filter without rendering every lesson.
 */
export function isLessonPublishable(lesson: { contentMd: string }): boolean {
  return lesson.contentMd.trim().length > 0;
}

export type BulkPublishScope =
  { kind: "module"; moduleId: string } | { kind: "course"; courseId: string };

/**
 * Bulk-publish every VALID draft lesson under a module or course — the review
 * of 64 imported drafts must not be 64 clicks. Only valid drafts flip; a single
 * audit entry records the count (spec 7.13: not a per-lesson log). Modules and
 * courses keep their own publish buttons — this touches lessons only.
 */
export async function publishLessonsInScope(
  db: PrismaClient,
  input: { actorId: string; scope: BulkPublishScope; now?: Date },
): Promise<
  | { ok: true; published: number; skipped: number; courseSlug: string }
  | { ok: false; code: "not_found" }
> {
  const now = input.now ?? new Date();

  let courseSlug: string;
  let where: { status: "draft"; moduleId?: string; module?: { courseId: string } };
  if (input.scope.kind === "module") {
    const mod = await db.module.findUnique({
      where: { id: input.scope.moduleId },
      include: { course: { select: { slug: true } } },
    });
    if (!mod) return { ok: false, code: "not_found" };
    courseSlug = mod.course.slug;
    where = { status: "draft", moduleId: mod.id };
  } else {
    const course = await db.course.findUnique({
      where: { id: input.scope.courseId },
      select: { slug: true },
    });
    if (!course) return { ok: false, code: "not_found" };
    courseSlug = course.slug;
    where = { status: "draft", module: { courseId: input.scope.courseId } };
  }

  const drafts = await db.lesson.findMany({
    where,
    select: { id: true, contentMd: true, publishedAt: true },
  });
  const valid = drafts.filter(isLessonPublishable);
  const skipped = drafts.length - valid.length;

  if (valid.length > 0) {
    const ids = valid.map((lesson) => lesson.id);
    const firstPublish = valid.filter((lesson) => lesson.publishedAt === null).map((l) => l.id);
    await db.$transaction(async (tx) => {
      await tx.lesson.updateMany({ where: { id: { in: ids } }, data: { status: "published" } });
      if (firstPublish.length > 0) {
        await tx.lesson.updateMany({
          where: { id: { in: firstPublish } },
          data: { publishedAt: now },
        });
      }
      await writeAudit(tx, {
        actorId: input.actorId,
        action: "lessons.bulk_published",
        entityType: input.scope.kind,
        entityId: input.scope.kind === "module" ? input.scope.moduleId : input.scope.courseId,
        after: { published: valid.length, skipped, lessonIds: ids },
      });
    });
  }

  return { ok: true, published: valid.length, skipped, courseSlug };
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
