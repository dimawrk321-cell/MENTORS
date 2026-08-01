import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { listCourseAccess, setAdminLock } from "@/lib/services/course-access";
import {
  applyChainOrder,
  migrateAllStudents,
  migrateStudentAccess,
  planChainOrder,
  runChainMigration,
} from "@/lib/services/course-chain-migration";

// Block 2v2.5: migrating the existing stand onto the chain. The rule the owner set
// — active students keep welcome + everything they already touched, the rest falls
// back to the chain — plus the requirement that a re-run changes nothing.

async function makeCourse(slug: string, title: string, order: number) {
  const course = await testDb.course.create({
    data: { slug, title, order, status: "published", gating: "free" },
  });
  const mod = await testDb.module.create({
    data: { courseId: course.id, title: `${title}: модуль`, order: 0, status: "published" },
  });
  const lesson = await testDb.lesson.create({
    data: {
      moduleId: mod.id,
      title: `${title}: урок`,
      slug: `${slug}-lesson`,
      order: 0,
      status: "published",
      contentMd: "текст",
    },
  });
  return { course, mod, lesson };
}

describe("chain order seeding (2v2.2)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("puts the owner's five courses first and keeps the rest in order", async () => {
    // Deliberately scrambled starting positions.
    await makeCourse("soft-skills", "Soft Skills", 0);
    await makeCourse("nlp-advanced", "NLP: продвинутый", 1);
    await makeCourse("welcome", "Знакомство с PRIME", 2);
    await makeCourse("ml-system-design", "ML System Design", 3);
    await makeCourse("python-pytorch", "Python + PyTorch", 4);
    await makeCourse("classic-ml-course", "Classic ML", 5);
    await makeCourse("nlp-basic", "NLP: базовый курс", 6);

    await applyChainOrder(testDb as never);

    const ordered = await testDb.course.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { slug: true },
    });
    expect(ordered.map((c) => c.slug)).toEqual([
      "welcome",
      "python-pytorch",
      "classic-ml-course",
      "nlp-basic",
      "nlp-advanced",
      // untouched tail, relative order preserved
      "soft-skills",
      "ml-system-design",
    ]);
  });

  it("tolerates a database without the named courses", async () => {
    await makeCourse("only-one", "Единственный", 7);
    await applyChainOrder(testDb as never);
    const course = await testDb.course.findUniqueOrThrow({ where: { slug: "only-one" } });
    expect(course.order).toBe(0);
  });

  it("re-running the order pass moves nothing", async () => {
    await makeCourse("welcome", "Знакомство", 3);
    await makeCourse("python-pytorch", "Python + PyTorch", 1);
    // python-pytorch already sits at 1; only welcome (3 → 0) actually moves.
    expect(await applyChainOrder(testDb as never)).toBe(1);
    expect(await applyChainOrder(testDb as never)).toBe(0);
    expect((await planChainOrder(testDb as never)).every((r) => r.from === r.to)).toBe(true);
  });
});

describe("student migration (2v2.5)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("opens welcome and every touched course, leaves the rest locked", async () => {
    const welcome = await makeCourse("welcome", "Знакомство", 0);
    const python = await makeCourse("python-pytorch", "Python + PyTorch", 1);
    const classic = await makeCourse("classic-ml-course", "Classic ML", 2);
    const user = await createTestUser({ email: "migrate-1@test.local" });

    // Started Python, never opened Classic ML.
    await testDb.lessonProgress.create({
      data: { userId: user.id, lessonId: python.lesson.id, status: "in_progress" },
    });

    const report = await migrateStudentAccess(testDb as never, { userId: user.id });
    expect(report.opened).toHaveLength(2);

    const rows = await listCourseAccess(testDb as never, user.id);
    const state = (id: string) => rows.find((r) => r.courseId === id)!.state;
    expect(state(welcome.course.id)).toBe("open_system");
    expect(state(python.course.id)).toBe("open_system");
    expect(state(classic.course.id)).toBe("locked_chain");
  });

  it("a finished course also opens the next link — nobody is left stuck", async () => {
    await makeCourse("welcome", "Знакомство", 0);
    const python = await makeCourse("python-pytorch", "Python + PyTorch", 1);
    const classic = await makeCourse("classic-ml-course", "Classic ML", 2);
    const user = await createTestUser({ email: "migrate-2@test.local" });

    await testDb.lessonProgress.create({
      data: {
        userId: user.id,
        lessonId: python.lesson.id,
        status: "completed",
        completedAt: new Date("2026-07-01T10:00:00.000Z"),
      },
    });

    await migrateStudentAccess(testDb as never, { userId: user.id });
    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows.find((r) => r.courseId === python.course.id)!.state).toBe("open_system");
    expect(rows.find((r) => r.courseId === classic.course.id)!.state).toBe("open_system");
  });

  it("is idempotent — the second run opens nothing", async () => {
    await makeCourse("welcome", "Знакомство", 0);
    const python = await makeCourse("python-pytorch", "Python + PyTorch", 1);
    const user = await createTestUser({ email: "migrate-3@test.local" });
    await testDb.lessonProgress.create({
      data: { userId: user.id, lessonId: python.lesson.id, status: "in_progress" },
    });

    const first = await migrateStudentAccess(testDb as never, { userId: user.id });
    const second = await migrateStudentAccess(testDb as never, { userId: user.id });
    expect(first.opened.length).toBeGreaterThan(0);
    expect(second.opened).toEqual([]);
    expect(await testDb.courseAccess.count({ where: { userId: user.id } })).toBe(2);
  });

  it("the dry run promises exactly what --commit then opens — reorder included", async () => {
    // The stand's shape when this was caught: the intended first link is NOT
    // first in the stored order, so a preview that skips the reorder reports a
    // different chain than --commit produces.
    await makeCourse("nlp-advanced", "NLP: продвинутый", 0);
    await makeCourse("welcome", "Знакомство", 1);
    const python = await makeCourse("python-pytorch", "Python + PyTorch", 2);
    const user = await createTestUser({ email: "migrate-4@test.local" });
    await testDb.lessonProgress.create({
      data: { userId: user.id, lessonId: python.lesson.id, status: "in_progress" },
    });

    const preview = await runChainMigration(testDb as never, { commit: false });
    expect(await testDb.courseAccess.count()).toBe(0); // rolled back
    expect((await testDb.course.findUniqueOrThrow({ where: { slug: "nlp-advanced" } })).order).toBe(
      0,
    ); // order rolled back too

    const applied = await runChainMigration(testDb as never, { commit: true });
    expect(applied.moved).toBe(preview.moved);
    expect(applied.reports.map((r) => r.opened)).toEqual(preview.reports.map((r) => r.opened));

    // …and the preview was right about the chain, not about the stale order:
    // the student keeps welcome + Python, and NLP продвинутый stays shut.
    const opened = applied.reports.flatMap((r) => r.opened);
    expect(opened).toContain("Знакомство");
    expect(opened).toContain("Python + PyTorch");
    expect(opened).not.toContain("NLP: продвинутый");
  });

  it("never lifts an admin lock", async () => {
    await makeCourse("welcome", "Знакомство", 0);
    const python = await makeCourse("python-pytorch", "Python + PyTorch", 1);
    const user = await createTestUser({ email: "migrate-5@test.local" });
    await testDb.lessonProgress.create({
      data: { userId: user.id, lessonId: python.lesson.id, status: "in_progress" },
    });
    await setAdminLock(testDb as never, {
      userId: user.id,
      courseId: python.course.id,
      locked: true,
    });

    await migrateStudentAccess(testDb as never, { userId: user.id });
    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows.find((r) => r.courseId === python.course.id)!.state).toBe("locked_admin");
  });

  it("migrates blocked students too — reinstating one must not wipe their access", async () => {
    await makeCourse("welcome", "Знакомство", 0);
    const python = await makeCourse("python-pytorch", "Python + PyTorch", 1);
    const active = await createTestUser({ email: "migrate-active@test.local" });
    const blocked = await createTestUser({ email: "migrate-blocked@test.local" });
    // Blocking only flips a status — the progress stays.
    await testDb.lessonProgress.create({
      data: { userId: blocked.id, lessonId: python.lesson.id, status: "in_progress" },
    });
    await testDb.user.update({ where: { id: blocked.id }, data: { status: "blocked" } });

    const summary = await migrateAllStudents(testDb as never);
    expect(summary.reports.map((r) => r.userId).sort()).toEqual([active.id, blocked.id].sort());

    const rows = await listCourseAccess(testDb as never, blocked.id);
    expect(rows.find((r) => r.courseId === python.course.id)!.state).toBe("open_system");
  });
});
