import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { publishLessonsInScope, isLessonPublishable } from "@/lib/services/content-admin";

// Bulk «Опубликовать уроки» on a module/course (spec 8.5): only valid draft
// lessons flip, one audit entry carries the count, re-run is a no-op.

async function makeCourse() {
  const owner = await createTestUser({ email: "owner@x.io", role: "owner" });
  const course = await testDb.course.create({
    data: {
      slug: "c",
      title: "C",
      status: "draft",
      modules: {
        create: [
          {
            title: "M1",
            order: 0,
            status: "draft",
            lessons: {
              create: [
                { slug: "l1", title: "L1", order: 0, status: "draft", contentMd: "Есть контент" },
                { slug: "l2", title: "L2", order: 1, status: "draft", contentMd: "   " },
                { slug: "l3", title: "L3", order: 2, status: "published", contentMd: "x" },
              ],
            },
          },
          {
            title: "M2",
            order: 1,
            status: "draft",
            lessons: {
              create: [
                { slug: "l4", title: "L4", order: 0, status: "draft", contentMd: "Ещё контент" },
              ],
            },
          },
        ],
      },
    },
    include: { modules: { orderBy: { order: "asc" }, include: { lessons: true } } },
  });
  return { owner, course, m1: course.modules[0]!, m2: course.modules[1]! };
}

describe("publishLessonsInScope", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("isLessonPublishable rejects empty/whitespace content", () => {
    expect(isLessonPublishable({ contentMd: "" })).toBe(false);
    expect(isLessonPublishable({ contentMd: "  \n\t " })).toBe(false);
    expect(isLessonPublishable({ contentMd: "есть" })).toBe(true);
  });

  it("publishes only non-empty drafts in a module, audits once with the count", async () => {
    const { owner, m1 } = await makeCourse();
    const res = await publishLessonsInScope(testDb, {
      actorId: owner.id,
      scope: { kind: "module", moduleId: m1.id },
    });
    expect(res).toMatchObject({ ok: true, published: 1, skipped: 1 });

    const audits = await testDb.auditLog.findMany({ where: { action: "lessons.bulk_published" } });
    expect(audits).toHaveLength(1);
    expect((audits[0]!.after as { published: number; skipped: number }).published).toBe(1);
    expect(audits[0]!.entityType).toBe("module");

    // l1 published (with publishedAt), l2 stays draft, l3 unchanged.
    const l1 = await testDb.lesson.findUniqueOrThrow({
      where: { moduleId_slug: { moduleId: m1.id, slug: "l1" } },
    });
    expect(l1.status).toBe("published");
    expect(l1.publishedAt).not.toBeNull();
    const l2 = await testDb.lesson.findUniqueOrThrow({
      where: { moduleId_slug: { moduleId: m1.id, slug: "l2" } },
    });
    expect(l2.status).toBe("draft");
  });

  it("publishes across all modules for a course scope", async () => {
    const { owner, course } = await makeCourse();
    const res = await publishLessonsInScope(testDb, {
      actorId: owner.id,
      scope: { kind: "course", courseId: course.id },
    });
    expect(res).toMatchObject({ ok: true, published: 2, skipped: 1 });
    expect(await testDb.lesson.count({ where: { status: "published" } })).toBe(3); // l1, l4 + already-published l3
  });

  it("re-run is a no-op: nothing left to publish, no extra audit", async () => {
    const { owner, m1 } = await makeCourse();
    await publishLessonsInScope(testDb, {
      actorId: owner.id,
      scope: { kind: "module", moduleId: m1.id },
    });
    const again = await publishLessonsInScope(testDb, {
      actorId: owner.id,
      scope: { kind: "module", moduleId: m1.id },
    });
    expect(again).toMatchObject({ ok: true, published: 0, skipped: 1 }); // only the empty l2 remains
    expect(await testDb.auditLog.count({ where: { action: "lessons.bulk_published" } })).toBe(1);
  });

  it("returns not_found for a missing scope", async () => {
    const owner = await createTestUser({ email: "o2@x.io", role: "owner" });
    const res = await publishLessonsInScope(testDb, {
      actorId: owner.id,
      scope: { kind: "module", moduleId: "nope" },
    });
    expect(res).toEqual({ ok: false, code: "not_found" });
  });
});
