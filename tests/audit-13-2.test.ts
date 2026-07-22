import { beforeEach, describe, expect, it } from "vitest";
import { sanitizeUrl, renderMarkdownHtml } from "@/lib/utils/markdown";
import { cancelBooking, markNoShow } from "@/lib/services/mocks";
import { extendAccess } from "@/lib/services/access";
import { deleteModule, deleteLesson } from "@/lib/services/content-admin";
import { deleteQuestion } from "@/lib/services/questions";
import { addDays, addMinutes } from "@/lib/utils/dates";
import { resetDb, testDb, createTestUser } from "./helpers/db";
import { createInterviewer, createStudent } from "./helpers/mocks";

// Walk 13.2 block 7 — regressions for the confirmed adversarial-audit findings.

const NOW = new Date("2026-07-08T12:00:00.000Z");

// --- Finding 1: javascript: URL sanitization (markdown pipeline) ---
describe("sanitizeUrl / markdown href scheme allowlist (13.2 audit #1)", () => {
  it("rewrites dangerous schemes to a safe value", () => {
    expect(sanitizeUrl("javascript:alert(1)", "href")).toBe("#");
    expect(sanitizeUrl("JavaScript:alert(1)", "href")).toBe("#");
    // obfuscated with control chars / whitespace inside the scheme
    expect(sanitizeUrl("java\tscript:alert(1)", "href")).toBe("#");
    expect(sanitizeUrl("  javascript:alert(1)", "href")).toBe("#");
    expect(sanitizeUrl("vbscript:msgbox(1)", "href")).toBe("#");
    expect(sanitizeUrl("data:text/html;base64,PHNjcmlwdD4=", "href")).toBe("#");
  });

  it("keeps safe hrefs and relative/anchor/mailto", () => {
    expect(sanitizeUrl("https://example.com", "href")).toBe("https://example.com");
    expect(sanitizeUrl("mailto:a@b.io", "href")).toBe("mailto:a@b.io");
    expect(sanitizeUrl("/lessons/x", "href")).toBe("/lessons/x");
    expect(sanitizeUrl("#toc", "href")).toBe("#toc");
    expect(sanitizeUrl("relative/path", "href")).toBe("relative/path");
  });

  it("allows only data:image for src, drops other src schemes", () => {
    expect(sanitizeUrl("data:image/png;base64,AAAA", "src")).toBe("data:image/png;base64,AAAA");
    expect(sanitizeUrl("javascript:1", "src")).toBe("");
  });

  it("renderMarkdownHtml (dangerouslySetInnerHTML sink) neutralizes javascript: links", async () => {
    const html = await renderMarkdownHtml("[click](javascript:alert(document.cookie))");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });
});

// --- Findings 3/4: concurrent double-cancel / double-no-show → one strike ---
describe("mock cancellation idempotency under concurrency (13.2 audit #3/#4)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function makeBooking(startsAt: Date) {
    const interviewer = await createInterviewer("i@test.local");
    const student = await createStudent("s@test.local");
    const booking = await testDb.booking.create({
      data: {
        slot: {
          create: {
            interviewerId: interviewer.id,
            startsAt,
            endsAt: addMinutes(startsAt, 60),
            status: "booked",
          },
        },
        user: { connect: { id: student.id } },
        type: "theory",
        status: "booked",
        roomUrl: "https://telemost.yandex.ru/room",
      },
      include: { slot: true },
    });
    return { interviewer, student, booking };
  }

  it("two concurrent late cancels issue exactly ONE late_cancel strike", async () => {
    const { student, booking } = await makeBooking(addMinutes(NOW, 60)); // <24h → late
    const [a, b] = await Promise.all([
      cancelBooking(testDb, { userId: student.id, bookingId: booking.id, now: NOW }),
      cancelBooking(testDb, { userId: student.id, bookingId: booking.id, now: NOW }),
    ]);
    // Exactly one winner; the loser is a clean not_cancellable no-op.
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await testDb.bookingStrike.count({ where: { userId: student.id } })).toBe(1);
  });

  it("two concurrent no-shows issue exactly ONE no_show strike", async () => {
    const { interviewer, student, booking } = await makeBooking(addMinutes(NOW, -20)); // past +10min
    const [a, b] = await Promise.all([
      markNoShow(testDb, { interviewerId: interviewer.id, bookingId: booking.id, now: NOW }),
      markNoShow(testDb, { interviewerId: interviewer.id, bookingId: booking.id, now: NOW }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await testDb.bookingStrike.count({ where: { userId: student.id } })).toBe(1);
  });
});

// --- Finding 5: extendAccess must not resurrect a blocked (security) account ---
describe("extendAccess refuses blocked students (13.2 audit #5)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns code=blocked and leaves status=blocked", async () => {
    const actor = await createTestUser({ email: "owner@test.local", role: "owner" });
    const student = await createTestUser({
      email: "sharer@test.local",
      role: "student",
      status: "blocked",
      accessUntil: addDays(NOW, 30),
    });
    const res = await extendAccess(testDb, {
      actorId: actor.id,
      userId: student.id,
      term: { kind: "days", days: 30 },
      now: NOW,
    });
    expect(res).toEqual({ ok: false, code: "blocked" });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: student.id } })).status).toBe(
      "blocked",
    );
  });
});

// --- Finding 6: deletion refused when student history exists (cascade guard) ---
describe("draft deletion guarded by dependent student data (13.2 audit #6)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function draftLesson() {
    const actor = await createTestUser({ email: "owner@test.local", role: "owner" });
    const student = await createStudent("s@test.local");
    const course = await testDb.course.create({
      data: {
        slug: "c",
        title: "C",
        gating: "free",
        status: "draft",
        modules: {
          create: {
            title: "M",
            order: 0,
            status: "draft",
            lessons: { create: { slug: "l", title: "L", order: 0, status: "draft" } },
          },
        },
      },
      include: { modules: { include: { lessons: true } } },
    });
    const moduleId = course.modules[0]!.id;
    const lessonId = course.modules[0]!.lessons[0]!.id;
    return { actor, student, moduleId, lessonId };
  }

  it("refuses deleteLesson / deleteModule when LessonProgress exists", async () => {
    const { actor, student, moduleId, lessonId } = await draftLesson();
    await testDb.lessonProgress.create({ data: { userId: student.id, lessonId } });

    expect(await deleteLesson(testDb, { actorId: actor.id, lessonId })).toEqual({
      ok: false,
      code: "has_student_data",
    });
    expect(await deleteModule(testDb, { actorId: actor.id, moduleId })).toEqual({
      ok: false,
      code: "has_student_data",
    });
    // Nothing was deleted.
    expect(await testDb.lesson.count({ where: { id: lessonId } })).toBe(1);
  });

  it("refuses deleteQuestion when an SRS card exists", async () => {
    const actor = await createTestUser({ email: "owner@test.local", role: "owner" });
    const student = await createStudent("s@test.local");
    const category = await testDb.questionCategory.create({
      data: { title: "C", slug: "c", colorIndex: 0, order: 0 },
    });
    const question = await testDb.question.create({
      data: {
        type: "open",
        categoryId: category.id,
        textMd: "Q",
        answerMd: "A",
        status: "draft",
        difficulty: 1,
      },
    });
    await testDb.srsCard.create({
      data: { userId: student.id, questionId: question.id, nextReviewAt: NOW, addedFrom: "manual" },
    });

    expect(await deleteQuestion(testDb, { actorId: actor.id, questionId: question.id })).toEqual({
      ok: false,
      code: "has_student_data",
    });
    expect(await testDb.question.count({ where: { id: question.id } })).toBe(1);
  });
});
