import { beforeEach, describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_BY_KEY,
  getUserAchievements,
  seedAchievements,
  ACHIEVEMENTS,
} from "@/lib/services/achievements";
import { emitEvent } from "@/lib/services/events";
import { completeLesson } from "@/lib/services/content";
import { answerTestQuestion, finishTestAttempt, startTestAttempt } from "@/lib/services/tests";
import { addDays, dateOnlyUtc, localDateStr } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { CORRECT, makeTestedCourse } from "./helpers/content-fixture";

// Обязательный набор этапа 5 (spec 7.7/19): first_*, perfect_test, five_first_try
// (сброс серии при провале), cards_100, queue_month, streak_*, скрытые night_shift
// (00:00–05:00 TZ) и combo (недостижимо без мока — прямой эмит mock.completed).

const NOW = new Date("2026-07-13T12:00:00.000Z"); // Москва 15:00
const TZ = "Europe/Moscow";

beforeEach(async () => {
  await resetDb();
});

async function earnedKeys(userId: string): Promise<Set<string>> {
  const rows = await testDb.userAchievement.findMany({ where: { userId } });
  return new Set(rows.map((row) => row.achievementKey));
}

async function answerAllCorrect(userId: string, attemptId: string): Promise<void> {
  const attempt = await testDb.testAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  for (const questionId of attempt.questionIds as string[]) {
    await answerTestQuestion(testDb, { userId, attemptId, questionId, answer: CORRECT, now: NOW });
  }
}

describe("завершения: first_lesson / first_module (spec 7.7)", () => {
  it("первое завершение урока → first_lesson", async () => {
    const user = await createTestUser({ email: "fl@test.local", timezone: TZ });
    const fixture = await makeTestedCourse();
    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson1Id, now: NOW });
    expect(await earnedKeys(user.id)).toContain("first_lesson");
  });

  it("закрытие модуля (тест выключен) → first_module", async () => {
    const user = await createTestUser({ email: "fm@test.local", timezone: TZ });
    const fixture = await makeTestedCourse({ enabled: false });
    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson1Id, now: NOW });
    let keys = await earnedKeys(user.id);
    expect(keys.has("first_module")).toBe(false); // урок 2 ещё не завершён

    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson2Id, now: NOW });
    keys = await earnedKeys(user.id);
    expect(keys).toContain("first_module");
  });
});

describe("закрытие модуля/курса — «настоящие» ворота (этап 5)", () => {
  it("вакуумный курс (только необязательный урок, без теста) не даёт first_course/all_courses", async () => {
    const user = await createTestUser({ email: "vac@test.local", timezone: TZ });
    const course = await testDb.course.create({
      data: {
        slug: "vac",
        title: "Вакуум",
        gating: "free",
        status: "published",
        modules: {
          create: {
            title: "M",
            order: 0,
            status: "published",
            lessons: {
              create: {
                slug: "opt",
                title: "Необязательный",
                order: 0,
                status: "published",
                isOptional: true,
                contentMd: "# x",
              },
            },
          },
        },
      },
      include: { modules: { include: { lessons: true } } },
    });
    const lessonId = course.modules[0]!.lessons[0]!.id;

    await completeLesson(testDb, { userId: user.id, lessonId, now: NOW });
    const keys = await earnedKeys(user.id);
    expect(keys).toContain("first_lesson"); // первый шаг — да
    expect(keys.has("first_module")).toBe(false); // модуль без «ворот» — не настоящий
    expect(keys.has("first_course")).toBe(false);
    expect(keys.has("all_courses")).toBe(false);
  });

  it("модуль, закрываемый только сдачей теста (без обязательных уроков), даёт first_module", async () => {
    const user = await createTestUser({ email: "tstmod@test.local", timezone: TZ });
    const category = await testDb.questionCategory.create({
      data: { title: "C", slug: "c-tstmod", colorIndex: 0, order: 0 },
    });
    const course = await testDb.course.create({
      data: {
        slug: "tstmod",
        title: "Тест-модуль",
        gating: "free",
        status: "published",
        modules: {
          create: {
            title: "M",
            order: 0,
            status: "published",
            lessons: {
              create: {
                slug: "opt",
                title: "Необязательный",
                order: 0,
                status: "published",
                isOptional: true,
                contentMd: "# x",
              },
            },
          },
        },
      },
      include: { modules: { include: { lessons: true } } },
    });
    const mod = course.modules[0]!;
    const question = await testDb.question.create({
      data: {
        type: "single",
        categoryId: category.id,
        textMd: "q",
        options: [
          { id: "a", text: "A", correct: true },
          { id: "b", text: "B", correct: false },
        ],
        status: "published",
        difficulty: 1,
      },
    });
    await testDb.questionLesson.create({
      data: { questionId: question.id, lessonId: mod.lessons[0]!.id, isKey: false, inQuiz: false },
    });
    await testDb.moduleTest.create({
      data: { moduleId: mod.id, poolSize: 1, threshold: 80, cooldownMinutes: 45, enabled: true },
    });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: mod.id,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    await answerAllCorrect(user.id, started.attemptId);
    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    expect(finished).toMatchObject({ ok: true, score: 100 });
    expect(await earnedKeys(user.id)).toContain("first_module");
  });
});

describe("тесты: perfect_test / five_first_try (spec 7.7)", () => {
  it("модульный тест на 100% → perfect_test", async () => {
    const user = await createTestUser({ email: "pt@test.local", timezone: TZ });
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5 });
    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    await answerAllCorrect(user.id, started.attemptId);
    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    expect(finished).toMatchObject({ ok: true, score: 100 });
    expect(await earnedKeys(user.id)).toContain("perfect_test");
  });

  it("5 модульных тестов подряд с 1-й попытки → five_first_try", async () => {
    const user = await createTestUser({ email: "fft@test.local", timezone: TZ });
    for (let i = 1; i <= 4; i += 1) {
      await emitEvent(
        testDb,
        "test.passed",
        { moduleId: `m${i}`, kind: "module", attemptNumber: 1, score: 90 },
        { userId: user.id, now: NOW },
      );
    }
    expect((await earnedKeys(user.id)).has("five_first_try")).toBe(false);
    await emitEvent(
      testDb,
      "test.passed",
      { moduleId: "m5", kind: "module", attemptNumber: 1, score: 90 },
      { userId: user.id, now: NOW },
    );
    expect(await earnedKeys(user.id)).toContain("five_first_try");
  });

  it("провал сбрасывает серию first-try", async () => {
    const user = await createTestUser({ email: "fftr@test.local", timezone: TZ });
    const pass = (moduleId: string) =>
      emitEvent(
        testDb,
        "test.passed",
        { moduleId, kind: "module", attemptNumber: 1, score: 90 },
        { userId: user.id, now: NOW },
      );

    await pass("m1");
    await pass("m2");
    await pass("m3");
    await pass("m4");
    // Провал рвёт серию.
    await emitEvent(
      testDb,
      "test.failed",
      { moduleId: "m5", kind: "module", attemptNumber: 1, score: 40 },
      { userId: user.id, now: NOW },
    );
    await pass("m6");
    await pass("m7");
    await pass("m8");
    await pass("m9");
    expect((await earnedKeys(user.id)).has("five_first_try")).toBe(false); // серия только 4

    await pass("m10");
    expect(await earnedKeys(user.id)).toContain("five_first_try");
  });
});

describe("карточки и дисциплина: cards_100 / queue_month (spec 7.7)", () => {
  it("100 отвеченных карточек → cards_100", async () => {
    const user = await createTestUser({ email: "c100@test.local", timezone: TZ });
    const category = await testDb.questionCategory.create({
      data: { title: "C", slug: "c", colorIndex: 0, order: 0 },
    });
    const question = await testDb.question.create({
      data: {
        type: "open",
        categoryId: category.id,
        textMd: "q",
        status: "published",
        difficulty: 1,
      },
    });
    const card = await testDb.srsCard.create({
      data: {
        userId: user.id,
        questionId: question.id,
        addedFrom: "manual",
        nextReviewAt: dateOnlyUtc("2026-07-13"),
      },
    });
    await testDb.srsReview.createMany({
      data: Array.from({ length: 100 }, () => ({
        cardId: card.id,
        grade: "good" as const,
        prevStep: 0,
        newStep: 1,
      })),
    });

    await emitEvent(testDb, "card.reviewed", { cardId: card.id }, { userId: user.id, now: NOW });
    expect(await earnedKeys(user.id)).toContain("cards_100");
  });

  it("30 учебных дней подряд закрытая очередь → queue_month", async () => {
    const user = await createTestUser({ email: "qm@test.local", timezone: TZ });
    // 29 предыдущих дней уже закрыты; 30-й закрываем событием.
    const days = Array.from({ length: 29 }, (_, i) =>
      localDateStr(addDays(dateOnlyUtc("2026-07-13"), -(29 - i)), "UTC"),
    );
    await testDb.analyticsEvent.createMany({
      data: days.map((day) => ({ userId: user.id, type: "queue.completed", payload: { day } })),
    });

    const result = await emitEvent(
      testDb,
      "queue.completed",
      { day: "2026-07-13" },
      { userId: user.id, now: NOW },
    );
    expect(result.recorded).toBe(true);
    expect(await earnedKeys(user.id)).toContain("queue_month");
  });
});

describe("вехи серии и скрытые (spec 7.7)", () => {
  it("streak.milestone → streak_7 / streak_365", async () => {
    const user = await createTestUser({ email: "sm@test.local", timezone: TZ });
    await emitEvent(testDb, "streak.milestone", { milestone: 7 }, { userId: user.id, now: NOW });
    await emitEvent(testDb, "streak.milestone", { milestone: 365 }, { userId: user.id, now: NOW });
    const keys = await earnedKeys(user.id);
    expect(keys).toContain("streak_7");
    expect(keys).toContain("streak_365");
  });

  it("night_shift (hidden): урок завершён 00:00–05:00 по TZ", async () => {
    const user = await createTestUser({ email: "ns@test.local", timezone: TZ });
    // Москва 03:00 (UTC+3) — ночная смена.
    const night = new Date("2026-07-13T00:00:00.000Z");
    await emitEvent(
      testDb,
      "lesson.completed",
      { lessonId: "l1" },
      { userId: user.id, now: night },
    );
    expect(await earnedKeys(user.id)).toContain("night_shift");
    expect(ACHIEVEMENT_BY_KEY.night_shift!.hidden).toBe(true);

    // Днём — не выдаётся.
    const day = await createTestUser({ email: "ns2@test.local", timezone: TZ });
    await emitEvent(testDb, "lesson.completed", { lessonId: "l1" }, { userId: day.id, now: NOW });
    expect((await earnedKeys(day.id)).has("night_shift")).toBe(false);
  });

  it("combo (hidden): недостижимо без мока — логика ждёт 4 события", async () => {
    const user = await createTestUser({ email: "combo@test.local", timezone: TZ });
    // combo сверяет события за локальный день по времени их записи (created_at),
    // которое в бою совпадает с now — поэтому тест работает в реальном времени.
    const now = new Date();
    const day = localDateStr(now, TZ);
    await emitEvent(testDb, "lesson.completed", { lessonId: "l1" }, { userId: user.id, now });
    await emitEvent(
      testDb,
      "test.passed",
      { moduleId: "m1", kind: "module", attemptNumber: 2, score: 90 },
      { userId: user.id, now },
    );
    await emitEvent(testDb, "queue.completed", { day }, { userId: user.id, now });
    expect((await earnedKeys(user.id)).has("combo")).toBe(false); // без мока недостижимо

    await emitEvent(testDb, "mock.completed", { bookingId: "b1" }, { userId: user.id, now });
    expect(await earnedKeys(user.id)).toContain("combo");
    expect(ACHIEVEMENT_BY_KEY.combo!.hidden).toBe(true);
  });
});

describe("справочник и витрина", () => {
  it("seedAchievements наполняет таблицу всеми определениями", async () => {
    await seedAchievements(testDb);
    expect(await testDb.achievement.count()).toBe(ACHIEVEMENTS.length);
  });

  it("getUserAchievements: счётчик и список полученных", async () => {
    const user = await createTestUser({ email: "sum@test.local", timezone: TZ });
    await emitEvent(testDb, "streak.milestone", { milestone: 7 }, { userId: user.id, now: NOW });
    const summary = await getUserAchievements(testDb, user.id);
    expect(summary.count).toBe(1);
    expect(summary.earned[0]).toMatchObject({ key: "streak_7", title: "Неделя" });
  });
});
