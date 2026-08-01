import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import {
  adminSetCourseAccess,
  canOpenCourse,
  isCourseComplete,
  listCourseAccess,
  requiredLessonCounts,
  setAdminLock,
  unlockCourse,
  unlockNextAfter,
} from "@/lib/services/course-access";

// Block 2v2: the hard course chain. These pin the owner's six requirements —
// a newcomer's default, auto-progression, early unlock, admin lock outranking
// the chain, and idempotency.

const NOW = new Date("2026-08-01T10:00:00.000Z");

/**
 * A published course with one required published lesson. The lesson matters:
 * a course with nothing to finish is a pass-through link in the chain (see
 * «empty courses never hold the chain shut»), so a fixture without lessons
 * would not model a real chain at all.
 */
async function makeCourse(slug: string, title: string, order: number) {
  const course = await testDb.course.create({
    data: { slug, title, order, status: "published", gating: "free" },
  });
  const mod = await testDb.module.create({
    data: { courseId: course.id, title: `${title}: модуль`, order: 0, status: "published" },
  });
  await testDb.lesson.create({
    data: {
      moduleId: mod.id,
      title: `${title}: урок`,
      slug: `${slug}-lesson`,
      order: 0,
      status: "published",
      contentMd: "текст",
    },
  });
  return course;
}

async function makeChain() {
  // welcome must be first in the chain; the rest follow by `order`.
  const welcome = await makeCourse("welcome", "Добро пожаловать", 0);
  const python = await makeCourse("python", "Python + PyTorch", 1);
  const classic = await makeCourse("classic-ml", "Classic ML", 2);
  return { welcome, python, classic };
}

let studentSeq = 0;
async function makeStudent() {
  studentSeq += 1;
  return createTestUser({ email: `chain-student-${studentSeq}@test.local` });
}

describe("course chain access", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a brand-new student has ONLY welcome open", async () => {
    const { welcome, python, classic } = await makeChain();
    const user = await makeStudent();

    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows.map((r) => r.slug)).toEqual(["welcome", "python", "classic-ml"]);
    expect(rows[0]!.state).toBe("open_welcome");
    expect(rows[1]!.state).toBe("locked_chain");
    expect(rows[2]!.state).toBe("locked_chain");

    expect(await canOpenCourse(testDb as never, user.id, welcome.id)).toBe(true);
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(false);
    expect(await canOpenCourse(testDb as never, user.id, classic.id)).toBe(false);
  });

  it("«Откроется после {курс}» names the previous link", async () => {
    await makeChain();
    const user = await makeStudent();
    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows[1]!.unlocksAfter).toBe("Добро пожаловать");
    expect(rows[2]!.unlocksAfter).toBe("Python + PyTorch");
  });

  it("finishing a course opens the next one, and only the next", async () => {
    const { welcome, python, classic } = await makeChain();
    const user = await makeStudent();

    const opened = await unlockNextAfter(testDb as never, {
      userId: user.id,
      completedCourseId: welcome.id,
      now: NOW,
    });
    expect(opened?.title).toBe("Python + PyTorch");

    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(true);
    expect(await canOpenCourse(testDb as never, user.id, classic.id)).toBe(false);
  });

  it("auto-unlock is idempotent — a replay opens nothing new", async () => {
    const { welcome } = await makeChain();
    const user = await makeStudent();

    const first = await unlockNextAfter(testDb as never, {
      userId: user.id,
      completedCourseId: welcome.id,
      now: NOW,
    });
    const second = await unlockNextAfter(testDb as never, {
      userId: user.id,
      completedCourseId: welcome.id,
      now: NOW,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // already open → no second notification
    expect(await testDb.courseAccess.count({ where: { userId: user.id } })).toBe(1);
  });

  it("the last course in the chain has no next to open", async () => {
    const { classic } = await makeChain();
    const user = await makeStudent();
    expect(
      await unlockNextAfter(testDb as never, {
        userId: user.id,
        completedCourseId: classic.id,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("admin can open a course early (unlocked_by=admin)", async () => {
    const { classic } = await makeChain();
    const user = await makeStudent();

    await unlockCourse(testDb as never, {
      userId: user.id,
      courseId: classic.id,
      by: "admin",
      now: NOW,
      force: true,
    });

    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows.find((r) => r.slug === "classic-ml")!.state).toBe("open_admin");
    expect(await canOpenCourse(testDb as never, user.id, classic.id)).toBe(true);
  });

  it("an admin lock OUTRANKS the chain — earned but still shut", async () => {
    const { welcome, python } = await makeChain();
    const user = await makeStudent();

    await setAdminLock(testDb as never, { userId: user.id, courseId: python.id, locked: true });
    // The chain now tries to open it; the admin lock must win.
    const opened = await unlockNextAfter(testDb as never, {
      userId: user.id,
      completedCourseId: welcome.id,
      now: NOW,
    });

    expect(opened).toBeNull();
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(false);
    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows.find((r) => r.slug === "python")!.state).toBe("locked_admin");
  });

  it("an admin lock also shuts a course that was already open", async () => {
    const { python } = await makeChain();
    const user = await makeStudent();
    await unlockCourse(testDb as never, {
      userId: user.id,
      courseId: python.id,
      by: "system",
      now: NOW,
    });
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(true);

    await setAdminLock(testDb as never, { userId: user.id, courseId: python.id, locked: true });
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(false);
  });

  it("lifting an admin lock via an admin unlock reopens the course", async () => {
    const { python } = await makeChain();
    const user = await makeStudent();
    await setAdminLock(testDb as never, { userId: user.id, courseId: python.id, locked: true });

    await unlockCourse(testDb as never, {
      userId: user.id,
      courseId: python.id,
      by: "admin",
      now: NOW,
      force: true,
    });
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(true);
  });

  it("a newcomer needs no rows at all — welcome is open by default", async () => {
    await makeChain();
    const user = await makeStudent();
    expect(await testDb.courseAccess.count({ where: { userId: user.id } })).toBe(0);
    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows[0]!.state).toBe("open_welcome");
  });

  it("unpublishing welcome does not strand everyone — the new first link opens", async () => {
    const { welcome, python } = await makeChain();
    const user = await makeStudent();
    await testDb.course.update({ where: { id: welcome.id }, data: { status: "draft" } });

    const rows = await listCourseAccess(testDb as never, user.id);
    expect(rows[0]!.slug).toBe("python");
    expect(rows[0]!.state).toBe("open_welcome");
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(true);
  });

  it("the entry point follows the chain order, not the welcome slug", async () => {
    const { welcome, python } = await makeChain();
    const user = await makeStudent();
    // An admin drags Python to the front in the studio.
    await testDb.course.update({ where: { id: python.id }, data: { order: -1 } });

    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(true);
    expect(await canOpenCourse(testDb as never, user.id, welcome.id)).toBe(false);
  });
});

describe("empty courses never hold the chain shut", () => {
  beforeEach(async () => {
    await resetDb();
  });

  /** A course with one published, required lesson — i.e. something to finish. */
  async function withContent(slug: string, title: string, order: number) {
    const course = await testDb.course.create({
      data: { slug, title, order, status: "published", gating: "free" },
    });
    const mod = await testDb.module.create({
      data: { courseId: course.id, title: `${title}: модуль`, order: 0, status: "published" },
    });
    await testDb.lesson.create({
      data: {
        moduleId: mod.id,
        title: `${title}: урок`,
        slug: `${slug}-lesson`,
        order: 0,
        status: "published",
        contentMd: "текст",
      },
    });
    return course;
  }

  it("walks past a content-less link to the next real course", async () => {
    // Exactly the stand's shape: Classic ML sits mid-chain with no lessons.
    const welcome = await withContent("welcome", "Знакомство", 0);
    const shell = await testDb.course.create({
      data: { slug: "classic-ml", title: "Classic ML", order: 1, status: "published" },
    });
    const nlp = await withContent("nlp-basic", "NLP: базовый", 2);
    const later = await withContent("nlp-advanced", "NLP: продвинутый", 3);
    const user = await makeStudent();

    const opened = await unlockNextAfter(testDb as never, {
      userId: user.id,
      completedCourseId: welcome.id,
      now: NOW,
    });

    // The shell opens silently; the notification names the course with content.
    expect(opened?.title).toBe("NLP: базовый");
    expect(await canOpenCourse(testDb as never, user.id, shell.id)).toBe(true);
    expect(await canOpenCourse(testDb as never, user.id, nlp.id)).toBe(true);
    // …and it does not run away to the end of the chain.
    expect(await canOpenCourse(testDb as never, user.id, later.id)).toBe(false);
  });

  it("a trailing shell still opens, with nothing to announce", async () => {
    const welcome = await withContent("welcome", "Знакомство", 0);
    const shell = await testDb.course.create({
      data: { slug: "soft-skills", title: "Soft Skills", order: 1, status: "published" },
    });
    const user = await makeStudent();

    const opened = await unlockNextAfter(testDb as never, {
      userId: user.id,
      completedCourseId: welcome.id,
      now: NOW,
    });
    expect(opened).toBeNull();
    expect(await canOpenCourse(testDb as never, user.id, shell.id)).toBe(true);
  });
});

describe("admin handles (block 2v2.4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function makeAdmin() {
    return createTestUser({ email: `chain-admin@test.local`, role: "owner" });
  }

  it("«открыть досрочно» opens the course and writes an audit entry", async () => {
    const { classic } = await makeChain();
    const user = await makeStudent();
    const admin = await makeAdmin();

    const res = await adminSetCourseAccess(testDb as never, {
      actorId: admin.id,
      userId: user.id,
      courseId: classic.id,
      action: "unlock",
      now: NOW,
    });
    expect(res).toEqual({ ok: true, state: "open_admin" });

    const audit = await testDb.auditLog.findMany({ where: { entityId: user.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("user.course_access_unlock");
    expect(audit[0]!.actorId).toBe(admin.id);
  });

  it("«вернуть в цепь» after an early open re-locks the course", async () => {
    const { classic } = await makeChain();
    const user = await makeStudent();
    const admin = await makeAdmin();

    await adminSetCourseAccess(testDb as never, {
      actorId: admin.id,
      userId: user.id,
      courseId: classic.id,
      action: "unlock",
      now: NOW,
    });
    const res = await adminSetCourseAccess(testDb as never, {
      actorId: admin.id,
      userId: user.id,
      courseId: classic.id,
      action: "unlock_reset",
    });
    expect(res).toEqual({ ok: true, state: "locked_chain" });
    expect(await canOpenCourse(testDb as never, user.id, classic.id)).toBe(false);
  });

  it("lifting an admin lock does NOT erase a course the student earned", async () => {
    const { welcome, python } = await makeChain();
    const user = await makeStudent();
    const admin = await makeAdmin();

    // Earned by finishing welcome…
    await unlockNextAfter(testDb as never, {
      userId: user.id,
      completedCourseId: welcome.id,
      now: NOW,
    });
    // …then locked and unlocked by an admin.
    await adminSetCourseAccess(testDb as never, {
      actorId: admin.id,
      userId: user.id,
      courseId: python.id,
      action: "lock",
    });
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(false);

    const res = await adminSetCourseAccess(testDb as never, {
      actorId: admin.id,
      userId: user.id,
      courseId: python.id,
      action: "unlock_reset",
    });
    expect(res).toEqual({ ok: true, state: "open_system" });
  });

  it("refuses an unknown student or course", async () => {
    const { python } = await makeChain();
    const admin = await makeAdmin();
    expect(
      await adminSetCourseAccess(testDb as never, {
        actorId: admin.id,
        userId: "nope",
        courseId: python.id,
        action: "lock",
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});

describe("isCourseComplete", () => {
  it("needs every module closed (lessons AND module test)", () => {
    expect(isCourseComplete(new Map([["m1", { closed: true }]]), 3)).toBe(true);
    expect(
      isCourseComplete(
        new Map([
          ["m1", { closed: true }],
          ["m2", { closed: false }],
        ]),
        3,
      ),
    ).toBe(false);
  });

  it("an empty course is not complete", () => {
    expect(isCourseComplete(new Map(), 0)).toBe(false);
  });

  it("a course with published-but-empty modules is not complete", () => {
    // Every module is trivially «closed», but there was nothing to finish — this
    // must not cascade the chain open (caught on the local stand dry-run).
    expect(isCourseComplete(new Map([["m1", { closed: true }]]), 0)).toBe(false);
  });
});

describe("the «Откроется после» hint names a course that can actually be finished", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("skips a pass-through link and names the last course with content", async () => {
    await makeCourse("welcome", "Знакомство", 0);
    // An empty shell sits between welcome and the locked course.
    await testDb.course.create({
      data: { slug: "shell", title: "Пустышка", order: 1, status: "published" },
    });
    await makeCourse("nlp", "NLP", 2);

    const user = await makeStudent();
    const rows = await listCourseAccess(testDb as never, user.id);
    const nlp = rows.find((r) => r.slug === "nlp")!;
    expect(nlp.state).toBe("locked_chain");
    // NOT «Пустышка» — finishing it is impossible, so the promise would be a lie.
    expect(nlp.unlocksAfter).toBe("Знакомство");
  });

  it("verifies the required-lesson rollup the hint depends on", async () => {
    const course = await testDb.course.create({
      data: { slug: "multi", title: "Мульти", order: 0, status: "published" },
    });
    const m1 = await testDb.module.create({
      data: { courseId: course.id, title: "М1", order: 0, status: "published" },
    });
    const m2 = await testDb.module.create({
      data: { courseId: course.id, title: "М2", order: 1, status: "published" },
    });
    const draftModule = await testDb.module.create({
      data: { courseId: course.id, title: "Черновик", order: 2, status: "draft" },
    });
    const lesson = (moduleId: string, slug: string, extra: Record<string, unknown> = {}) =>
      testDb.lesson.create({
        data: {
          moduleId,
          slug,
          title: slug,
          order: 0,
          status: "published",
          contentMd: "т",
          ...extra,
        },
      });
    await lesson(m1.id, "a");
    await lesson(m1.id, "b");
    await lesson(m2.id, "c");
    await lesson(m2.id, "optional", { isOptional: true }); // not required
    await lesson(m1.id, "draft-lesson", { status: "draft" }); // not published
    await lesson(draftModule.id, "in-draft-module"); // module not published

    const counts = await requiredLessonCounts(testDb as never);
    expect(counts.get(course.id)).toBe(3);
  });
});
