import { beforeEach, describe, expect, it } from "vitest";
import {
  completeLesson,
  getCourseView,
  getLessonView,
  savePosition,
  startLesson,
} from "@/lib/services/content";
import { saveLessonContent } from "@/lib/services/content-admin";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// DB-backed stage-2 flow: gating over real queries, published-only visibility,
// idempotent completion with events, positions, content_updated_at semantics.

const NOW = new Date("2026-07-07T12:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

async function makeStudent(email = "student@test.local") {
  return createTestUser({
    email,
    passwordHash: "unused",
    activatedAt: new Date(NOW.getTime() - 10 * 86_400_000),
    accessUntil: new Date(NOW.getTime() + 80 * 86_400_000),
  });
}

/** strict course: M1 = [L1, L2(optional), L3], M2 = [L4] + one draft lesson. */
async function makeCourse(gating: "strict" | "recommended" | "free" = "strict") {
  const course = await testDb.course.create({
    data: {
      slug: "course",
      title: "Курс",
      gating,
      status: "published",
      modules: {
        create: [
          {
            title: "Модуль 1",
            order: 0,
            status: "published",
            lessons: {
              create: [
                { slug: "l1", title: "Урок 1", order: 0, status: "published", contentMd: "# 1" },
                {
                  slug: "l2",
                  title: "Урок 2 (доп)",
                  order: 1,
                  status: "published",
                  isOptional: true,
                  contentMd: "# 2",
                },
                { slug: "l3", title: "Урок 3", order: 2, status: "published", contentMd: "# 3" },
                { slug: "draft", title: "Черновик", order: 3, status: "draft", contentMd: "# d" },
              ],
            },
          },
          {
            title: "Модуль 2",
            order: 1,
            status: "published",
            lessons: {
              create: [
                { slug: "l4", title: "Урок 4", order: 0, status: "published", contentMd: "# 4" },
              ],
            },
          },
        ],
      },
    },
    include: { modules: { include: { lessons: true }, orderBy: { order: "asc" } } },
  });
  const bySlug = new Map(
    course.modules.flatMap((m) => m.lessons.map((l) => [l.slug, l.id] as const)),
  );
  return { course, bySlug };
}

describe("gating over the database", () => {
  it("draft lessons are invisible to students and do not affect gating", async () => {
    const user = await makeStudent();
    const { bySlug } = await makeCourse();

    const view = await getCourseView(testDb, "course", user.id);
    const allIds = [...view!.state.lessons.keys()];
    expect(allIds).not.toContain(bySlug.get("draft"));
    // Draft lesson URL is a 404 for students.
    expect(await getLessonView(testDb, bySlug.get("draft")!, user.id)).toBeNull();
  });

  it("completing lessons unlocks the course step by step and auto-advances", async () => {
    const user = await makeStudent();
    const { bySlug } = await makeCourse();
    const l1 = bySlug.get("l1")!;
    const l3 = bySlug.get("l3")!;
    const l4 = bySlug.get("l4")!;

    // L3 and L4 locked at the start.
    expect((await getLessonView(testDb, l3, user.id))?.unlocked).toBe(false);
    const lockedView = await getLessonView(testDb, l3, user.id);
    expect(lockedView?.unlockReason).toEqual({ kind: "lesson", id: l1, title: "Урок 1" });
    // Completing a locked lesson is rejected.
    expect(await completeLesson(testDb, { userId: user.id, lessonId: l3, now: NOW })).toEqual({
      ok: false,
      code: "locked",
    });

    // L1 → optional L2 becomes next, L3 open, L4 still locked.
    const afterL1 = await completeLesson(testDb, { userId: user.id, lessonId: l1, now: NOW });
    expect(afterL1.ok && afterL1.nextLessonId).toBe(bySlug.get("l2"));
    expect((await getLessonView(testDb, l4, user.id))?.unlocked).toBe(false);

    // L3 closes module 1 (optional L2 не блокирует) → L4 opens.
    await completeLesson(testDb, { userId: user.id, lessonId: l3, now: NOW });
    expect((await getLessonView(testDb, l4, user.id))?.unlocked).toBe(true);
  });

  it("completion is explicit and idempotent, events fire once", async () => {
    const user = await makeStudent();
    const { bySlug } = await makeCourse();
    const l1 = bySlug.get("l1")!;

    await startLesson(testDb, { userId: user.id, lessonId: l1, now: NOW });
    await startLesson(testDb, { userId: user.id, lessonId: l1, now: NOW }); // no-op
    expect(
      await testDb.analyticsEvent.count({ where: { type: "lesson.started", userId: user.id } }),
    ).toBe(1);

    await completeLesson(testDb, { userId: user.id, lessonId: l1, now: NOW });
    const again = await completeLesson(testDb, { userId: user.id, lessonId: l1, now: NOW });
    expect(again.ok).toBe(true);
    expect(
      await testDb.analyticsEvent.count({ where: { type: "lesson.completed", userId: user.id } }),
    ).toBe(1);

    const progress = await testDb.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId: l1 } },
    });
    expect(progress?.status).toBe("completed");
    expect(progress?.completedAt?.getTime()).toBe(NOW.getTime());
  });

  it("reading positions upsert and clamp", async () => {
    const user = await makeStudent();
    const { bySlug } = await makeCourse();
    const l1 = bySlug.get("l1")!;

    await savePosition(testDb, { userId: user.id, lessonId: l1, scrollPos: 0.42, videoPos: 90 });
    await savePosition(testDb, { userId: user.id, lessonId: l1, scrollPos: 1.7 }); // clamp, video untouched

    const progress = await testDb.lessonProgress.findUnique({
      where: { userId_lessonId: { userId: user.id, lessonId: l1 } },
    });
    expect(progress?.scrollPos).toBe(1);
    expect(progress?.videoPos).toBe(90);
    expect(progress?.status).toBe("in_progress");
  });
});

describe("«урок обновлён» + reading_minutes on save (spec 6/7.3)", () => {
  it("content change after completion raises the badge; reading_minutes recomputed", async () => {
    const user = await makeStudent();
    const { bySlug } = await makeCourse();
    const l1 = bySlug.get("l1")!;

    await completeLesson(testDb, { userId: user.id, lessonId: l1, now: NOW });

    // Saving the SAME content must not bump content_updated_at.
    const before = await testDb.lesson.findUniqueOrThrow({ where: { id: l1 } });
    await saveLessonContent(testDb as never, {
      lessonId: l1,
      contentMd: "# 1",
      now: new Date(NOW.getTime() + 1000),
    });
    const unchanged = await testDb.lesson.findUniqueOrThrow({ where: { id: l1 } });
    expect(unchanged.contentUpdatedAt.getTime()).toBe(before.contentUpdatedAt.getTime());

    // A real change bumps it → the badge appears for the completed user.
    const newContent = Array(200).fill("слово").join(" ");
    await saveLessonContent(testDb as never, {
      lessonId: l1,
      contentMd: newContent,
      now: new Date(NOW.getTime() + 2000),
    });
    const updated = await testDb.lesson.findUniqueOrThrow({ where: { id: l1 } });
    expect(updated.readingMinutes).toBe(2);

    const view = await getCourseView(testDb, "course", user.id);
    expect(view?.state.lessons.get(l1)?.updatedSinceCompletion).toBe(true);
  });
});
