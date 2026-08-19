import { beforeEach, describe, expect, it } from "vitest";
import { completeLesson, getCourseView, getLessonView } from "@/lib/services/content";
import {
  answerTestQuestion,
  finishTestAttempt,
  getModulePoolCounts,
  getModuleQuestionPool,
  getTestOverview,
  startTestAttempt,
} from "@/lib/services/tests";
import { poolEligible } from "@/lib/utils/answers";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { CORRECT, makeTestedCourse, WRONG } from "./helpers/content-fixture";

// Mandatory suite (stage 3): выборка из пула (фиксация, без повторов,
// min-правило), порог и first-try, кулдаун, test-out с зачётом модуля,
// isModuleTestPassed в гейтинге (spec 7.3/7.5).

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

function parseIds(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

/** Отвечает на все вопросы попытки: первые `wrong` — неверно, остальные верно. */
async function answerAll(userId: string, attemptId: string, wrong = 0): Promise<void> {
  const attempt = await testDb.testAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const ids = parseIds(attempt.questionIds);
  for (const [index, questionId] of ids.entries()) {
    const result = await answerTestQuestion(testDb, {
      userId,
      attemptId,
      questionId,
      answer: index < wrong ? WRONG : CORRECT,
    });
    expect(result.ok).toBe(true);
  }
}

describe("выборка из пула (spec 7.5)", () => {
  it("фиксируется в попытке, без повторов, размер = pool_size", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 8, poolSize: 4 });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const attempt = await testDb.testAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
    });
    const ids = parseIds(attempt.questionIds);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4); // без повторов
    for (const id of ids) expect(fixture.questionIds).toContain(id); // подмножество пула
  });

  it("min-правило: пул меньше pool_size → берутся все", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 3, poolSize: 5 });

    const overview = await getTestOverview(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      now: NOW,
    });
    expect(overview?.attemptSize).toBe(3);

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    const attempt = await testDb.testAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
    });
    expect(parseIds(attempt.questionIds).sort()).toEqual([...fixture.questionIds].sort());
  });

  it("повторный старт продолжает активную попытку (обновление страницы не теряет прогресс)", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse();

    const first = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    const second = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!first.ok || !second.ok) throw new Error("start failed");
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.resumed).toBe(true);
  });
});

describe("порог и завершение (spec 7.5)", () => {
  it("score = round(верных/всего×100); ровно порог — сдано; событие несёт attemptNumber", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5, threshold: 80 });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    await answerAll(user.id, started.attemptId, 1); // 4 из 5 = 80%

    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    expect(finished).toMatchObject({ ok: true, score: 80, passed: true, threshold: 80 });

    const event = await testDb.analyticsEvent.findFirst({
      where: { type: "test.passed", userId: user.id },
    });
    expect(event).not.toBeNull();
    expect((event!.payload as { attemptNumber?: number }).attemptNumber).toBe(1);

    // Повторное завершение — идемпотентно отклоняется.
    const again = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    expect(again).toEqual({ ok: false, code: "finished" });
  });

  it("неотвеченные вопросы считаются неверными", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 3, poolSize: 3 });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    const attempt = await testDb.testAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
    });
    const [firstQuestion] = parseIds(attempt.questionIds);
    await answerTestQuestion(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      questionId: firstQuestion!,
      answer: CORRECT,
    });

    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    expect(finished).toMatchObject({ ok: true, score: 33, passed: false });
    const failEvent = await testDb.analyticsEvent.findFirst({
      where: { type: "test.failed", userId: user.id },
    });
    expect(failEvent).not.toBeNull();
  });

  it("пересдача после провала: кулдаун держит, потом новая выборка; attemptNumber растёт", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5, cooldownMinutes: 45 });

    const first = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!first.ok) throw new Error("start failed");
    await answerAll(user.id, first.attemptId, 5); // 0%
    await finishTestAttempt(testDb, { userId: user.id, attemptId: first.attemptId, now: NOW });

    // Сразу — кулдаун (spec 7.5: пересдача через cooldown_minutes).
    const tooSoon = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: new Date(NOW.getTime() + 44 * 60_000),
    });
    expect(tooSoon).toEqual({ ok: false, code: "cooldown" });

    // После кулдауна — новая попытка.
    const later = new Date(NOW.getTime() + 46 * 60_000);
    const second = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: later,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.resumed).toBe(false);

    await answerAll(user.id, second.attemptId, 0); // 100%
    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: second.attemptId,
      now: later,
    });
    expect(finished).toMatchObject({ ok: true, passed: true });

    const event = await testDb.analyticsEvent.findFirst({
      where: { type: "test.passed", userId: user.id },
    });
    expect((event!.payload as { attemptNumber?: number }).attemptNumber).toBe(2); // не first try
  });
});

describe("test-out (spec 7.3)", () => {
  it("порог 90: успех зачитывает уроки модуля и открывает следующий", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5, threshold: 80 });

    // Урок 4 (модуль 2) заперт: уроки модуля 1 не пройдены.
    expect((await getLessonView(testDb, fixture.lesson4Id, user.id))?.unlocked).toBe(false);

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "testout",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    await answerAll(user.id, started.attemptId, 0); // 100% ≥ 90
    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    expect(finished).toMatchObject({ ok: true, passed: true, threshold: 90 });

    // Уроки модуля зачтены…
    for (const lessonId of [fixture.lesson1Id, fixture.lesson2Id]) {
      const progress = await testDb.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: user.id, lessonId } },
      });
      expect(progress?.status).toBe("completed");
    }
    // …модуль закрыт, следующий открыт.
    const view = await getCourseView(testDb, fixture.courseSlug, user.id);
    expect(view?.state.modules.get(fixture.moduleId)?.closed).toBe(true);
    expect(view?.state.lessons.get(fixture.lesson4Id)?.unlocked).toBe(true);

    // Пометка «via testout» в аналитике; lesson.completed НЕ эмитится (XP 7.3).
    const testoutEvent = await testDb.analyticsEvent.findFirst({
      where: { type: "testout.passed", userId: user.id },
    });
    expect(testoutEvent).not.toBeNull();
    const payload = testoutEvent!.payload as { via?: string; lessonIds?: string[] };
    expect(payload.via).toBe("testout");
    expect(payload.lessonIds).toHaveLength(2);
    expect(
      await testDb.analyticsEvent.count({ where: { type: "lesson.completed", userId: user.id } }),
    ).toBe(0);
  });

  it("89% — провал экстерна: уроки не зачтены, кулдаун действует", async () => {
    const user = await makeStudent();
    // 5 вопросов: 4/5 = 80 < 90.
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5 });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "testout",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    await answerAll(user.id, started.attemptId, 1); // 80%
    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    expect(finished).toMatchObject({ ok: true, passed: false, threshold: 90 });

    expect(
      await testDb.lessonProgress.count({ where: { userId: user.id, status: "completed" } }),
    ).toBe(0);

    const tooSoon = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "testout",
      now: new Date(NOW.getTime() + 10 * 60_000),
    });
    expect(tooSoon).toEqual({ ok: false, code: "cooldown" });
  });
});

describe("isModuleTestPassed в гейтинге (spec 7.3)", () => {
  it("уроки завершены, но включённый тест не сдан → модуль не закрыт, замок «после теста»", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 3, poolSize: 3 });

    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson1Id, now: NOW });
    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson2Id, now: NOW });

    const view = await getCourseView(testDb, fixture.courseSlug, user.id);
    expect(view?.state.modules.get(fixture.moduleId)?.closed).toBe(false);
    expect(view?.state.lessons.get(fixture.lesson4Id)?.unlocked).toBe(false);

    const lockedLesson = await getLessonView(testDb, fixture.lesson4Id, user.id);
    expect(lockedLesson?.unlockReason).toEqual({
      kind: "module_test",
      moduleId: fixture.moduleId,
      moduleTitle: "Модуль 1",
    });

    // Сдаём тест → модуль закрывается, урок 4 открыт.
    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    await answerAll(user.id, started.attemptId, 0);
    await finishTestAttempt(testDb, { userId: user.id, attemptId: started.attemptId, now: NOW });

    const after = await getCourseView(testDb, fixture.courseSlug, user.id);
    expect(after?.state.modules.get(fixture.moduleId)?.closed).toBe(true);
    expect(after?.state.lessons.get(fixture.lesson4Id)?.unlocked).toBe(true);
    expect(after?.testStates.get(fixture.moduleId)?.passed).toBe(true);
  });

  it("выключенный тест не участвует в закрытии модуля", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ enabled: false });

    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson1Id, now: NOW });
    await completeLesson(testDb, { userId: user.id, lessonId: fixture.lesson2Id, now: NOW });

    const view = await getCourseView(testDb, fixture.courseSlug, user.id);
    expect(view?.state.modules.get(fixture.moduleId)?.closed).toBe(true);
    expect(view?.state.lessons.get(fixture.lesson4Id)?.unlocked).toBe(true);
  });
});

// --- Заход C.1: видимость пула и явные настройки экстерна ---

describe("пул теста: правило одно на два выражения (заход C.1)", () => {
  it("predicate == SQL: poolEligible совпадает с выборкой getModuleQuestionPool", async () => {
    const fixture = await makeTestedCourse({ poolQuestions: 1, poolSize: 5 });
    const lesson2 = fixture.lesson2Id;

    // Черновой урок в том же модуле — вопрос на нём в пул не идёт.
    const draftLesson = await testDb.lesson.create({
      data: {
        moduleId: fixture.moduleId,
        slug: "l3",
        title: "Урок 3",
        order: 2,
        status: "draft",
        contentMd: "# 3",
      },
    });

    const variants: Array<{
      name: string;
      type: "open" | "single" | "multi" | "tf" | "short_text";
      status: "draft" | "published";
      lessonId: string;
      lessonStatus: "draft" | "published";
    }> = [
      {
        name: "закрытый+опубл+опубл-урок",
        type: "single",
        status: "published",
        lessonId: lesson2,
        lessonStatus: "published",
      },
      {
        name: "закрытый tf",
        type: "tf",
        status: "published",
        lessonId: lesson2,
        lessonStatus: "published",
      },
      {
        name: "короткий ответ",
        type: "short_text",
        status: "published",
        lessonId: lesson2,
        lessonStatus: "published",
      },
      {
        name: "открытый",
        type: "open",
        status: "published",
        lessonId: lesson2,
        lessonStatus: "published",
      },
      {
        name: "закрытый черновик",
        type: "single",
        status: "draft",
        lessonId: lesson2,
        lessonStatus: "published",
      },
      {
        name: "закрытый на черновом уроке",
        type: "single",
        status: "published",
        lessonId: draftLesson.id,
        lessonStatus: "draft",
      },
    ];

    const created: Array<{ id: string; variant: (typeof variants)[number] }> = [];
    for (const variant of variants) {
      const question = await testDb.question.create({
        data: {
          type: variant.type,
          categoryId: fixture.categoryId,
          textMd: variant.name,
          status: variant.status,
          difficulty: 1,
          options:
            variant.type === "open" || variant.type === "short_text"
              ? undefined
              : [
                  { id: CORRECT, text: "Да", correct: true },
                  { id: WRONG, text: "Нет", correct: false },
                ],
          answerMd: variant.type === "open" ? "эталон" : undefined,
        },
      });
      // Роль «ключевой» — специально: пул роль не смотрит вовсе.
      await testDb.questionLesson.create({
        data: { questionId: question.id, lessonId: variant.lessonId, isKey: true, inQuiz: false },
      });
      created.push({ id: question.id, variant });
    }

    const pool = await getModuleQuestionPool(testDb, fixture.moduleId);
    const poolIds = new Set(pool.map((question) => question.id));

    for (const { id, variant } of created) {
      const predicate = poolEligible({
        questionType: variant.type,
        questionStatus: variant.status,
        lessonStatus: variant.lessonStatus,
      });
      expect({ name: variant.name, inPool: poolIds.has(id) }).toEqual({
        name: variant.name,
        inPool: predicate,
      });
    }
    // Три закрытых опубликованных на опубликованном уроке + 1 из фикстуры.
    expect(pool).toHaveLength(4);
  });

  it("роль связи на пул не влияет: «ключевой» и «просто привязан» идут одинаково", async () => {
    const fixture = await makeTestedCourse({ poolQuestions: 2, poolSize: 5 });
    await testDb.questionLesson.updateMany({
      where: { questionId: fixture.questionIds[0]! },
      data: { isKey: true },
    });
    const pool = await getModuleQuestionPool(testDb, fixture.moduleId);
    expect(pool.map((question) => question.id).sort()).toEqual([...fixture.questionIds].sort());
  });

  it("getModulePoolCounts считает пачкой то же, что поштучный пул", async () => {
    const fixture = await makeTestedCourse({ poolQuestions: 3, poolSize: 5 });
    const counts = await getModulePoolCounts(testDb, [fixture.moduleId, fixture.module2Id]);
    expect(counts.get(fixture.moduleId)).toBe(3);
    // У модуля 2 привязок нет — счётчика тоже нет, читатель подставляет 0.
    expect(counts.get(fixture.module2Id) ?? 0).toBe(0);
  });
});

describe("экстерн — явная настройка (заход C.1)", () => {
  it("выключенный тумблер отбивает старт экстерна, обычный тест не трогает", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5 });
    await testDb.moduleTest.update({
      where: { moduleId: fixture.moduleId },
      data: { testoutEnabled: false },
    });

    const testout = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "testout",
      now: NOW,
    });
    expect(testout).toEqual({ ok: false, code: "testout_disabled" });

    // Обычная сдача тем же тестом по-прежнему стартует.
    const regular = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "module",
      now: NOW,
    });
    expect(regular.ok).toBe(true);
  });

  it("порог экстерна берётся из строки теста, а не из константы", async () => {
    const user = await makeStudent();
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5 });
    await testDb.moduleTest.update({
      where: { moduleId: fixture.moduleId },
      data: { testoutThreshold: 80 },
    });

    const started = await startTestAttempt(testDb, {
      userId: user.id,
      moduleId: fixture.moduleId,
      kind: "testout",
      now: NOW,
    });
    if (!started.ok) throw new Error("start failed");
    await answerAll(user.id, started.attemptId, 1); // 4/5 = 80%
    const finished = await finishTestAttempt(testDb, {
      userId: user.id,
      attemptId: started.attemptId,
      now: NOW,
    });
    // При прежней константе 90 это был бы провал.
    expect(finished).toMatchObject({ ok: true, passed: true, threshold: 80 });
  });

  it("дефолты миграции повторяют прежнее поведение: экстерн разрешён, порог 90", async () => {
    const fixture = await makeTestedCourse({ poolQuestions: 5, poolSize: 5 });
    const test = await testDb.moduleTest.findUniqueOrThrow({
      where: { moduleId: fixture.moduleId },
    });
    expect(test.testoutEnabled).toBe(true);
    expect(test.testoutThreshold).toBe(90);
  });
});
