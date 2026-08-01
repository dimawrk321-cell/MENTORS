import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import {
  canOpenCourse,
  ensureInitialAccess,
  isCourseComplete,
  listCourseAccess,
  setAdminLock,
  unlockCourse,
  unlockNextAfter,
} from "@/lib/services/course-access";

// Block 2v2: the hard course chain. These pin the owner's six requirements —
// a newcomer's default, auto-progression, early unlock, admin lock outranking
// the chain, and idempotency.

const NOW = new Date("2026-08-01T10:00:00.000Z");

async function makeChain() {
  // welcome must be first in the chain; the rest follow by `order`.
  const welcome = await testDb.course.create({
    data: { slug: "welcome", title: "Добро пожаловать", order: 0, status: "published" },
  });
  const python = await testDb.course.create({
    data: { slug: "python", title: "Python + PyTorch", order: 1, status: "published" },
  });
  const classic = await testDb.course.create({
    data: { slug: "classic-ml", title: "Classic ML", order: 2, status: "published" },
  });
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

  it("ensureInitialAccess is idempotent and only touches welcome", async () => {
    await makeChain();
    const user = await makeStudent();
    await ensureInitialAccess(testDb as never, user.id, NOW);
    await ensureInitialAccess(testDb as never, user.id, NOW);

    const rows = await testDb.courseAccess.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unlockedBy).toBe("system");
  });
});

describe("isCourseComplete", () => {
  it("needs every module closed (lessons AND module test)", () => {
    expect(isCourseComplete(new Map([["m1", { closed: true }]]))).toBe(true);
    expect(
      isCourseComplete(
        new Map([
          ["m1", { closed: true }],
          ["m2", { closed: false }],
        ]),
      ),
    ).toBe(false);
  });

  it("an empty course is not complete", () => {
    expect(isCourseComplete(new Map())).toBe(false);
  });
});
