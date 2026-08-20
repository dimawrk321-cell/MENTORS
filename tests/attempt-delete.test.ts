import { beforeEach, describe, expect, it } from "vitest";
import { deleteTestAttempt } from "@/lib/services/tests";
import { createTestUser, resetDb, testDb } from "./helpers/db";
import { CORRECT, makeTestedCourse } from "./helpers/content-fixture";

// Заход C.3: owner-only снятие попытки теста. Гвард живёт В СЕРВИСЕ — здесь он
// и проверяется, без слоя действий и без UI.

const NOW = new Date("2026-08-20T12:00:00.000Z");

beforeEach(async () => {
  await resetDb();
});

async function makeAttempt() {
  const fixture = await makeTestedCourse({ poolQuestions: 3, poolSize: 3 });
  const student = await createTestUser({ email: "s@test.local", passwordHash: "x" });
  const attempt = await testDb.testAttempt.create({
    data: {
      userId: student.id,
      moduleId: fixture.moduleId,
      kind: "testout",
      questionIds: fixture.questionIds,
      score: 0,
      passed: false,
      startedAt: NOW,
      finishedAt: NOW,
    },
  });
  for (const questionId of fixture.questionIds) {
    await testDb.testAttemptAnswer.create({
      data: { attemptId: attempt.id, questionId, answer: CORRECT, correct: false },
    });
  }
  return { fixture, student, attempt };
}

describe("снятие попытки теста (заход C.3)", () => {
  it("владелец снимает попытку; ответы уходят каскадом; пишется аудит со снимком", async () => {
    const owner = await createTestUser({ email: "owner@test.local", role: "owner" });
    const { attempt, student } = await makeAttempt();
    expect(await testDb.testAttemptAnswer.count({ where: { attemptId: attempt.id } })).toBe(3);

    const res = await deleteTestAttempt(testDb, {
      actor: { id: owner.id, role: owner.role },
      attemptId: attempt.id,
    });
    expect(res).toEqual({ ok: true });

    expect(await testDb.testAttempt.count({ where: { id: attempt.id } })).toBe(0);
    expect(await testDb.testAttemptAnswer.count({ where: { attemptId: attempt.id } })).toBe(0);

    const audit = await testDb.auditLog.findFirst({
      where: { action: "test_attempt.deleted", entityId: attempt.id },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(owner.id);
    const before = audit!.before as { userId?: string; kind?: string; answers?: number };
    expect(before.userId).toBe(student.id);
    expect(before.kind).toBe("testout");
    expect(before.answers).toBe(3);
  });

  it("не-владелец получает forbidden, и попытка остаётся на месте", async () => {
    const { attempt } = await makeAttempt();
    for (const role of ["mentor", "admin", "student"] as const) {
      const actor = await createTestUser({ email: `${role}@test.local`, role });
      expect(
        await deleteTestAttempt(testDb, {
          actor: { id: actor.id, role: actor.role },
          attemptId: attempt.id,
        }),
      ).toEqual({ ok: false, code: "forbidden" });
    }
    expect(await testDb.testAttempt.count({ where: { id: attempt.id } })).toBe(1);
    expect(await testDb.testAttemptAnswer.count({ where: { attemptId: attempt.id } })).toBe(3);
    // Отказ не пишется в аудит как удаление.
    expect(await testDb.auditLog.count({ where: { action: "test_attempt.deleted" } })).toBe(0);
  });

  it("несуществующая попытка — not_found", async () => {
    const owner = await createTestUser({ email: "owner2@test.local", role: "owner" });
    expect(
      await deleteTestAttempt(testDb, {
        actor: { id: owner.id, role: owner.role },
        attemptId: "нет-такой",
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });

  it("серия, аналитика и карточки SRS остаются нетронутыми", async () => {
    const owner = await createTestUser({ email: "owner3@test.local", role: "owner" });
    const { attempt, student, fixture } = await makeAttempt();

    // Следы, которые снятие попытки трогать НЕ должно.
    await testDb.analyticsEvent.create({
      data: { userId: student.id, type: "test.failed", payload: { moduleId: fixture.moduleId } },
    });
    await testDb.streak.create({
      data: { userId: student.id, current: 3, best: 5, lastCountedDate: NOW },
    });
    await testDb.srsCard.create({
      data: {
        userId: student.id,
        questionId: fixture.questionIds[0]!,
        nextReviewAt: NOW,
        addedFrom: "test_fail",
      },
    });

    await deleteTestAttempt(testDb, {
      actor: { id: owner.id, role: owner.role },
      attemptId: attempt.id,
    });

    expect(
      await testDb.analyticsEvent.count({ where: { userId: student.id, type: "test.failed" } }),
    ).toBe(1);
    const streak = await testDb.streak.findUniqueOrThrow({ where: { userId: student.id } });
    expect(streak.current).toBe(3);
    expect(await testDb.srsCard.count({ where: { userId: student.id } })).toBe(1);
  });
});
