import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { canOpenCourse, unlockCourse } from "@/lib/services/course-access";

// Block 2v2.3: a locked course must not be reachable by a direct URL. These tests
// drive the REAL page functions (RSC are plain async functions) with the session
// guard mocked, and assert the redirect they perform.

const { redirectSpy, currentUser } = vi.hoisted(() => ({
  redirectSpy: vi.fn((url: string) => {
    // next/navigation's redirect() throws to unwind the render; mimic that so the
    // page cannot silently continue past the gate.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  currentUser: { id: "", adminId: "" },
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: redirectSpy,
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

vi.mock("@/lib/auth/guards", () => ({
  requireStudentZone: async () => ({
    user: { id: currentUser.id, track: null, role: "student" },
    session: { id: "test-session" },
    impersonated: false,
  }),
  requirePermission: async () => ({
    user: { id: currentUser.adminId, role: "owner", timezone: "Europe/Moscow" },
    session: { id: "test-admin-session" },
    impersonated: false,
  }),
}));

vi.mock("@/lib/db", async () => {
  const { testDb: db } = await import("./helpers/db");
  return { prisma: db };
});

async function makeChain() {
  const welcome = await testDb.course.create({
    data: { slug: "welcome", title: "Добро пожаловать", order: 0, status: "published" },
  });
  // welcome needs a required lesson: a course with nothing to finish is a
  // pass-through link, so it could never be the «Откроется после» blocker.
  const wMod = await testDb.module.create({
    data: { courseId: welcome.id, title: "Модуль", order: 0, status: "published" },
  });
  await testDb.lesson.create({
    data: {
      moduleId: wMod.id,
      title: "Вводный урок",
      slug: "welcome-first",
      order: 0,
      status: "published",
      contentMd: "текст",
    },
  });
  const python = await testDb.course.create({
    data: { slug: "python", title: "Python + PyTorch", order: 1, status: "published" },
  });
  const mod = await testDb.module.create({
    data: { courseId: python.id, title: "Модуль 1", order: 0, status: "published" },
  });
  const lesson = await testDb.lesson.create({
    data: {
      moduleId: mod.id,
      title: "Первый урок",
      slug: "python-first",
      order: 0,
      status: "published",
      contentMd: "текст",
    },
  });
  return { welcome, python, mod, lesson };
}

describe("locked course is not reachable by URL", () => {
  beforeEach(async () => {
    await resetDb();
    redirectSpy.mockClear();
  });

  it("/courses/[slug] on a locked course redirects to the catalog with a notice", async () => {
    const { python } = await makeChain();
    const user = await createTestUser({ email: "chain-route-1@test.local" });
    currentUser.id = user.id;

    const { default: CoursePage } = await import("@/app/(student)/courses/[slug]/page");
    await expect(CoursePage({ params: Promise.resolve({ slug: python.slug }) })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      `/courses?locked=${encodeURIComponent("Python + PyTorch")}`,
    );
  });

  it("a lesson inside a locked course redirects too — the lock is not bypassable", async () => {
    const { lesson } = await makeChain();
    const user = await createTestUser({ email: "chain-route-2@test.local" });
    currentUser.id = user.id;

    const { default: LessonPage } = await import("@/app/(student)/lessons/[id]/page");
    await expect(LessonPage({ params: Promise.resolve({ id: lesson.id }) })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(redirectSpy).toHaveBeenCalledWith(
      `/courses?locked=${encodeURIComponent("Python + PyTorch")}`,
    );
  });

  it("once the course is open the same URL renders", async () => {
    const { python } = await makeChain();
    const user = await createTestUser({ email: "chain-route-3@test.local" });
    currentUser.id = user.id;
    await unlockCourse(testDb as never, { userId: user.id, courseId: python.id, by: "system" });

    const { default: CoursePage } = await import("@/app/(student)/courses/[slug]/page");
    await expect(
      CoursePage({ params: Promise.resolve({ slug: python.slug }) }),
    ).resolves.toBeTruthy();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it("the welcome course is always reachable for a newcomer", async () => {
    const { welcome } = await makeChain();
    const user = await createTestUser({ email: "chain-route-4@test.local" });
    currentUser.id = user.id;

    const { default: CoursePage } = await import("@/app/(student)/courses/[slug]/page");
    await expect(
      CoursePage({ params: Promise.resolve({ slug: welcome.slug }) }),
    ).resolves.toBeTruthy();
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

describe("the lock is enforced BELOW the page, not only on it", () => {
  beforeEach(async () => {
    await resetDb();
    redirectSpy.mockClear();
  });

  it("/tests/[moduleId] of a locked course redirects to the catalog", async () => {
    const { mod } = await makeChain();
    const user = await createTestUser({ email: "chain-test-route@test.local" });
    currentUser.id = user.id;

    const { default: TestPage } = await import("@/app/(focused)/tests/[moduleId]/page");
    await expect(
      TestPage({
        params: Promise.resolve({ moduleId: mod.id }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectSpy).toHaveBeenCalledWith(
      `/courses?locked=${encodeURIComponent("Python + PyTorch")}`,
    );
  });

  it("completeLesson refuses a lesson inside a locked course", async () => {
    const { python, lesson } = await makeChain();
    const user = await createTestUser({ email: "chain-complete@test.local" });

    const { completeLesson } = await import("@/lib/services/content");
    const denied = await completeLesson(testDb as never, { userId: user.id, lessonId: lesson.id });
    expect(denied).toEqual({ ok: false, code: "course_locked" });
    expect(await testDb.lessonProgress.count({ where: { userId: user.id } })).toBe(0);

    // …and accepts it the moment the chain opens the course.
    await unlockCourse(testDb as never, { userId: user.id, courseId: python.id, by: "system" });
    const allowed = await completeLesson(testDb as never, { userId: user.id, lessonId: lesson.id });
    expect(allowed.ok).toBe(true);
  });

  it("the mock auto-completion opts out of the chain check", async () => {
    const { lesson } = await makeChain();
    const user = await createTestUser({ email: "chain-mock-complete@test.local" });

    const { completeLesson } = await import("@/lib/services/content");
    const result = await completeLesson(testDb as never, {
      userId: user.id,
      lessonId: lesson.id,
      systemAction: true,
    });
    expect(result.ok).toBe(true);
  });
});

/** Depth-first search for a component element by its function name. */
function findElement(node: unknown, name: string): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, name);
      if (hit) return hit;
    }
    return null;
  }
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  const type = element.type as { name?: string } | undefined;
  if (typeof type === "function" && type.name === name) {
    return { props: element.props ?? {} };
  }
  return element.props ? findElement(Object.values(element.props), name) : null;
}

describe("admin student card shows the chain (block 2v2.4)", () => {
  beforeEach(async () => {
    await resetDb();
    redirectSpy.mockClear();
  });

  it("renders a «Курсы» row per course with its state and unlock hint", async () => {
    const { welcome, python } = await makeChain();
    const student = await createTestUser({ email: "chain-admin-view@test.local" });
    const admin = await createTestUser({ email: "chain-admin@test.local", role: "owner" });
    currentUser.adminId = admin.id;

    const { default: StudentPage } = await import("@/app/(admin)/admin/students/[id]/page");
    const tree = await StudentPage({
      params: Promise.resolve({ id: student.id }),
      searchParams: Promise.resolve({}),
    });

    const controls = findElement(tree, "CourseAccessControls");
    expect(controls).not.toBeNull();
    expect(controls!.props.canManage).toBe(true);

    const courses = controls!.props.courses as Array<Record<string, unknown>>;
    expect(courses.map((c) => c.courseId)).toEqual(expect.arrayContaining([welcome.id, python.id]));
    expect(courses.find((c) => c.courseId === welcome.id)!.state).toBe("open_welcome");
    const pythonRow = courses.find((c) => c.courseId === python.id)!;
    expect(pythonRow.state).toBe("locked_chain");
    expect(pythonRow.unlocksAfter).toBe("Добро пожаловать");
  });
});

describe("the chain advances on a module test, not only on a lesson (audit blocker)", () => {
  beforeEach(async () => {
    await resetDb();
    redirectSpy.mockClear();
  });

  /** welcome (1 required lesson + an enabled module test) → python. */
  async function makeTestGatedChain() {
    const welcome = await testDb.course.create({
      data: { slug: "welcome", title: "Знакомство", order: 0, status: "published", gating: "free" },
    });
    const wMod = await testDb.module.create({
      data: { courseId: welcome.id, title: "Модуль", order: 0, status: "published" },
    });
    const wLesson = await testDb.lesson.create({
      data: {
        moduleId: wMod.id,
        slug: "w-lesson",
        title: "Урок",
        order: 0,
        status: "published",
        contentMd: "текст",
      },
    });
    const category = await testDb.questionCategory.create({
      data: { title: "Кат", slug: "kat", colorIndex: 0, order: 0 },
    });
    const question = await testDb.question.create({
      data: {
        type: "single",
        categoryId: category.id,
        textMd: "2+2?",
        answerMd: "4",
        status: "published",
        difficulty: 1,
        options: [
          { id: "a", text: "4", correct: true },
          { id: "b", text: "5", correct: false },
        ],
      },
    });
    // The module test pool is sourced through the lesson links (getModuleQuestionPool).
    await testDb.questionLesson.create({
      data: { questionId: question.id, lessonId: wLesson.id },
    });
    await testDb.moduleTest.create({
      data: { moduleId: wMod.id, enabled: true, poolSize: 1, threshold: 100, cooldownMinutes: 0 },
    });
    const python = await testDb.course.create({
      data: { slug: "python", title: "Python", order: 1, status: "published", gating: "free" },
    });
    const pMod = await testDb.module.create({
      data: { courseId: python.id, title: "Модуль", order: 0, status: "published" },
    });
    await testDb.lesson.create({
      data: {
        moduleId: pMod.id,
        slug: "p-lesson",
        title: "Урок",
        order: 0,
        status: "published",
        contentMd: "текст",
      },
    });
    return { welcome, wMod, wLesson, python, question };
  }

  it("finishing the last lesson does NOT open the next course while the test is unpassed", async () => {
    const { wLesson, python } = await makeTestGatedChain();
    const user = await createTestUser({ email: "chain-test-gate-1@test.local" });

    const { completeLesson } = await import("@/lib/services/content");
    const res = await completeLesson(testDb as never, { userId: user.id, lessonId: wLesson.id });
    expect(res.ok).toBe(true);
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(false);
  });

  it("passing the module test then opens it — the chain does not dead-end on a test", async () => {
    const { wLesson, wMod, python, question } = await makeTestGatedChain();
    const user = await createTestUser({ email: "chain-test-gate-2@test.local" });

    const { completeLesson, advanceChainIfCourseComplete } = await import("@/lib/services/content");
    await completeLesson(testDb as never, { userId: user.id, lessonId: wLesson.id });

    const { startTestAttempt, answerTestQuestion, finishTestAttempt } =
      await import("@/lib/services/tests");
    const started = await startTestAttempt(testDb as never, {
      userId: user.id,
      moduleId: wMod.id,
      kind: "module",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await answerTestQuestion(testDb as never, {
      userId: user.id,
      attemptId: started.attemptId,
      questionId: question.id,
      answer: "a",
    });
    const finished = await finishTestAttempt(testDb as never, {
      userId: user.id,
      attemptId: started.attemptId,
    });
    expect(finished.ok && finished.passed).toBe(true);

    // This is the hook finishTestAction runs after a pass.
    const opened = await advanceChainIfCourseComplete(testDb as never, {
      userId: user.id,
      courseSlug: "welcome",
    });
    expect(opened).toBe("Python");
    expect(await canOpenCourse(testDb as never, user.id, python.id)).toBe(true);

    // Idempotent: a second call opens nothing and notifies nobody twice.
    expect(
      await advanceChainIfCourseComplete(testDb as never, {
        userId: user.id,
        courseSlug: "welcome",
      }),
    ).toBeNull();
  });
});
