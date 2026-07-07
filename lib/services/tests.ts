import type { ModuleTest, PrismaClient, Question, TestKind } from "@prisma/client";
import type { Db } from "@/lib/db";
import { checkAnswer, CLOSED_QUESTION_TYPES } from "@/lib/utils/answers";
import { randomShuffle } from "@/lib/utils/shuffle";
import { emitEvent } from "@/lib/services/events";
import { writeAudit } from "@/lib/services/audit";

// Module tests & test-out (spec 7.5/7.3). Gating-related availability (which
// module is reachable/locked) lives in the content service; the action layer
// combines both — this keeps tests.ts free of a content.ts import cycle
// (content.ts consumes getModuleTestStates below for its gating hook).

export const TESTOUT_THRESHOLD = 90;

export interface ModuleTestState {
  test: ModuleTest;
  passed: boolean;
  /** Score of the best PASSED attempt (module or testout) — «сдан {score}%». */
  bestPassedScore: number | null;
}

/** Batch state for gating and the ModuleTree test rows. */
export async function getModuleTestStates(
  db: Db,
  userId: string,
  moduleIds: string[],
): Promise<Map<string, ModuleTestState>> {
  if (moduleIds.length === 0) return new Map();
  const tests = await db.moduleTest.findMany({ where: { moduleId: { in: moduleIds } } });
  if (tests.length === 0) return new Map();

  const passedAttempts = await db.testAttempt.findMany({
    where: { userId, moduleId: { in: moduleIds }, passed: true },
    select: { moduleId: true, score: true },
  });
  const bestByModule = new Map<string, number>();
  for (const attempt of passedAttempts) {
    const best = bestByModule.get(attempt.moduleId);
    if (best === undefined || attempt.score > best) {
      bestByModule.set(attempt.moduleId, attempt.score);
    }
  }

  return new Map(
    tests.map((test) => [
      test.moduleId,
      {
        test,
        passed: bestByModule.has(test.moduleId),
        bestPassedScore: bestByModule.get(test.moduleId) ?? null,
      },
    ]),
  );
}

/** Gating hook (spec 7.3): module counts as tested unless an enabled test is unpassed. */
export function makeModuleTestHook(
  states: Map<string, ModuleTestState>,
): (moduleId: string) => boolean {
  return (moduleId) => {
    const state = states.get(moduleId);
    if (!state || !state.test.enabled) return true;
    return state.passed;
  };
}

/** Пул теста: закрытые published-вопросы published-уроков модуля (spec 7.5). */
export async function getModuleQuestionPool(db: Db, moduleId: string): Promise<Question[]> {
  const links = await db.questionLesson.findMany({
    where: {
      lesson: { moduleId, status: "published" },
      question: { status: "published", type: { in: [...CLOSED_QUESTION_TYPES] } },
    },
    select: { questionId: true },
  });
  const ids = [...new Set(links.map((link) => link.questionId))];
  if (ids.length === 0) return [];
  return db.question.findMany({ where: { id: { in: ids } } });
}

function parseQuestionIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export interface TestOverview {
  test: ModuleTest;
  poolCount: number;
  /** min-правило: сколько вопросов реально будет в попытке. */
  attemptSize: number;
  activeAttempt: { id: string; kind: TestKind } | null;
  passedAttemptId: string | null;
  lastFailed: { id: string; kind: TestKind; score: number; finishedAt: Date } | null;
  finishedModuleAttempts: number;
  /** Кулдаун пересдачи по kind (spec 7.5). */
  cooldownUntil: Partial<Record<TestKind, Date>>;
}

export async function getTestOverview(
  db: Db,
  input: { userId: string; moduleId: string; now?: Date },
): Promise<TestOverview | null> {
  const now = input.now ?? new Date();
  const test = await db.moduleTest.findUnique({ where: { moduleId: input.moduleId } });
  if (!test) return null;

  const pool = await getModuleQuestionPool(db, input.moduleId);
  const attempts = await db.testAttempt.findMany({
    where: { userId: input.userId, moduleId: input.moduleId },
    orderBy: { startedAt: "desc" },
  });

  const active = attempts.find((attempt) => attempt.finishedAt === null) ?? null;
  const passed = attempts.find((attempt) => attempt.passed) ?? null;
  const lastFailedAttempt =
    attempts.find((attempt) => attempt.finishedAt !== null && !attempt.passed) ?? null;

  const cooldownUntil: Partial<Record<TestKind, Date>> = {};
  for (const kind of ["module", "testout"] as const) {
    const lastFailedOfKind = attempts.find(
      (attempt) => attempt.kind === kind && attempt.finishedAt !== null && !attempt.passed,
    );
    if (lastFailedOfKind?.finishedAt) {
      const until = new Date(lastFailedOfKind.finishedAt.getTime() + test.cooldownMinutes * 60_000);
      if (until > now) cooldownUntil[kind] = until;
    }
  }

  return {
    test,
    poolCount: pool.length,
    attemptSize: Math.min(test.poolSize, pool.length),
    activeAttempt: active ? { id: active.id, kind: active.kind } : null,
    passedAttemptId: passed?.id ?? null,
    lastFailed:
      lastFailedAttempt?.finishedAt != null
        ? {
            id: lastFailedAttempt.id,
            kind: lastFailedAttempt.kind,
            score: lastFailedAttempt.score,
            finishedAt: lastFailedAttempt.finishedAt,
          }
        : null,
    finishedModuleAttempts: attempts.filter(
      (attempt) => attempt.kind === "module" && attempt.finishedAt !== null,
    ).length,
    cooldownUntil,
  };
}

export type StartTestResult =
  | { ok: true; attemptId: string; resumed: boolean }
  | { ok: false; code: "no_test" | "disabled" | "no_questions" | "cooldown" | "already_passed" };

/**
 * Starts (or resumes) an attempt: the random selection of min(pool_size, pool)
 * questions is fixed on the attempt (spec 7.5) — a page refresh resumes it.
 * DECISION: one unfinished attempt per module (any kind) — it is resumed
 * instead of stacking parallel attempts.
 */
export async function startTestAttempt(
  db: Db,
  input: { userId: string; moduleId: string; kind: TestKind; now?: Date },
): Promise<StartTestResult> {
  const now = input.now ?? new Date();
  const overview = await getTestOverview(db, {
    userId: input.userId,
    moduleId: input.moduleId,
    now,
  });
  if (!overview) return { ok: false, code: "no_test" };
  if (!overview.test.enabled) return { ok: false, code: "disabled" };
  if (overview.passedAttemptId) return { ok: false, code: "already_passed" };

  if (overview.activeAttempt) {
    return { ok: true, attemptId: overview.activeAttempt.id, resumed: true };
  }
  const cooldown = overview.cooldownUntil[input.kind];
  if (cooldown) return { ok: false, code: "cooldown" };
  if (overview.poolCount === 0) return { ok: false, code: "no_questions" };

  const pool = await getModuleQuestionPool(db, input.moduleId);
  // Новая выборка на каждую попытку (spec 7.5: пересдача — новая выборка).
  const selection = randomShuffle(pool)
    .slice(0, Math.min(overview.test.poolSize, pool.length))
    .map((question) => question.id);

  const attempt = await db.testAttempt.create({
    data: {
      userId: input.userId,
      moduleId: input.moduleId,
      kind: input.kind,
      questionIds: selection,
      startedAt: now,
    },
  });
  await emitEvent(
    db,
    "test.started",
    { moduleId: input.moduleId, kind: input.kind, questions: selection.length },
    { userId: input.userId },
  );
  return { ok: true, attemptId: attempt.id, resumed: false };
}

export type AnswerTestResult =
  | { ok: true; answered: number; total: number }
  | { ok: false; code: "not_found" | "finished" | "foreign_question" | "already_answered" };

/** Records one answer; correctness is hidden until the attempt is finished (spec 7.5). */
export async function answerTestQuestion(
  db: Db,
  input: { userId: string; attemptId: string; questionId: string; answer: unknown; now?: Date },
): Promise<AnswerTestResult> {
  const attempt = await db.testAttempt.findUnique({ where: { id: input.attemptId } });
  if (!attempt || attempt.userId !== input.userId) return { ok: false, code: "not_found" };
  if (attempt.finishedAt !== null) return { ok: false, code: "finished" };
  const questionIds = parseQuestionIds(attempt.questionIds);
  if (!questionIds.includes(input.questionId)) return { ok: false, code: "foreign_question" };

  const existing = await db.testAttemptAnswer.findUnique({
    where: { attemptId_questionId: { attemptId: attempt.id, questionId: input.questionId } },
  });
  if (existing) return { ok: false, code: "already_answered" };

  const question = await db.question.findUnique({ where: { id: input.questionId } });
  if (!question) return { ok: false, code: "foreign_question" };

  await db.testAttemptAnswer.create({
    data: {
      attemptId: attempt.id,
      questionId: question.id,
      answer: input.answer as never,
      correct: checkAnswer(question, input.answer),
    },
  });
  const answered = await db.testAttemptAnswer.count({ where: { attemptId: attempt.id } });
  return { ok: true, answered, total: questionIds.length };
}

export type FinishTestResult =
  | { ok: true; score: number; passed: boolean; threshold: number }
  | { ok: false; code: "not_found" | "finished" };

/**
 * Finishes the attempt: score = round(correct/total×100); unanswered questions
 * count as wrong. Test-out pass (порог 90) зачитывает модуль: published-уроки →
 * completed. DECISION: no lesson.completed events are emitted for the testout
 * credit — spec 7.3 forbids lesson XP here, and the stage-5 XP engine will pay
 * per lesson.completed; the single testout.passed event carries lessonIds
 * («пометка via testout» для аналитики).
 */
export async function finishTestAttempt(
  db: PrismaClient,
  input: { userId: string; attemptId: string; now?: Date },
): Promise<FinishTestResult> {
  const now = input.now ?? new Date();
  const attempt = await db.testAttempt.findUnique({
    where: { id: input.attemptId },
    include: { answers: { select: { correct: true } } },
  });
  if (!attempt || attempt.userId !== input.userId) return { ok: false, code: "not_found" };
  if (attempt.finishedAt !== null) return { ok: false, code: "finished" };

  const test = await db.moduleTest.findUnique({ where: { moduleId: attempt.moduleId } });
  const threshold = attempt.kind === "testout" ? TESTOUT_THRESHOLD : (test?.threshold ?? 80);
  const total = parseQuestionIds(attempt.questionIds).length;
  const correct = attempt.answers.filter((answer) => answer.correct).length;
  const score = total === 0 ? 0 : Math.round((correct / total) * 100);
  const passed = score >= threshold;

  await db.$transaction(async (tx) => {
    await tx.testAttempt.update({
      where: { id: attempt.id },
      data: { score, passed, finishedAt: now },
    });

    // The update above already marked this attempt finished — the count
    // includes it, so it IS the attempt number (test.passed_first_try ⇔ 1).
    const attemptNumber = await tx.testAttempt.count({
      where: {
        userId: attempt.userId,
        moduleId: attempt.moduleId,
        kind: attempt.kind,
        finishedAt: { not: null },
      },
    });

    if (attempt.kind === "module") {
      await emitEvent(
        tx,
        passed ? "test.passed" : "test.failed",
        { moduleId: attempt.moduleId, score, threshold, attemptNumber, kind: "module" },
        { userId: attempt.userId },
      );
      return;
    }

    // --- testout ---
    if (!passed) {
      await emitEvent(
        tx,
        "test.failed",
        { moduleId: attempt.moduleId, score, threshold, attemptNumber, kind: "testout" },
        { userId: attempt.userId },
      );
      return;
    }

    const lessons = await tx.lesson.findMany({
      where: { moduleId: attempt.moduleId, status: "published" },
      select: { id: true },
    });
    for (const lesson of lessons) {
      await tx.lessonProgress.upsert({
        where: { userId_lessonId: { userId: attempt.userId, lessonId: lesson.id } },
        create: {
          userId: attempt.userId,
          lessonId: lesson.id,
          status: "completed",
          completedAt: now,
        },
        update: { status: "completed", completedAt: now },
      });
    }
    await emitEvent(
      tx,
      "testout.passed",
      {
        moduleId: attempt.moduleId,
        score,
        via: "testout",
        lessonIds: lessons.map((lesson) => lesson.id),
      },
      { userId: attempt.userId },
    );
  });

  return { ok: true, score, passed, threshold };
}

/** Runner state: fixed question order, already answered set (refresh-safe). */
export async function getAttemptForRunner(db: Db, input: { attemptId: string; userId: string }) {
  const attempt = await db.testAttempt.findUnique({
    where: { id: input.attemptId },
    include: { answers: { select: { questionId: true } } },
  });
  if (!attempt || attempt.userId !== input.userId) return null;
  const questionIds = parseQuestionIds(attempt.questionIds);
  const questions = await db.question.findMany({ where: { id: { in: questionIds } } });
  const byId = new Map(questions.map((question) => [question.id, question]));
  return {
    attempt,
    questions: questionIds
      .map((id) => byId.get(id))
      .filter((question): question is Question => question !== undefined),
    answeredIds: new Set(attempt.answers.map((answer) => answer.questionId)),
  };
}

export interface AttemptReview {
  attempt: { id: string; kind: TestKind; score: number; passed: boolean; finishedAt: Date };
  threshold: number;
  /** passed: полный разбор; failed: только темы ошибок (spec 7.5). */
  review: Array<{ question: Question; answer: unknown; correct: boolean }> | null;
  failedTopics: string[];
}

export async function getAttemptReview(
  db: Db,
  input: { attemptId: string; userId: string },
): Promise<AttemptReview | null> {
  const attempt = await db.testAttempt.findUnique({
    where: { id: input.attemptId },
    include: { answers: true },
  });
  if (!attempt || attempt.userId !== input.userId || attempt.finishedAt === null) return null;

  const test = await db.moduleTest.findUnique({ where: { moduleId: attempt.moduleId } });
  const threshold = attempt.kind === "testout" ? TESTOUT_THRESHOLD : (test?.threshold ?? 80);
  const questionIds = parseQuestionIds(attempt.questionIds);
  const questions = await db.question.findMany({
    where: { id: { in: questionIds } },
    include: { category: { select: { title: true, parent: { select: { title: true } } } } },
  });
  const byId = new Map(questions.map((question) => [question.id, question]));
  const answerByQuestion = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));

  if (attempt.passed) {
    return {
      attempt: {
        id: attempt.id,
        kind: attempt.kind,
        score: attempt.score,
        passed: true,
        finishedAt: attempt.finishedAt,
      },
      threshold,
      review: questionIds
        .map((id) => {
          const question = byId.get(id);
          if (!question) return null;
          const answer = answerByQuestion.get(id);
          return { question, answer: answer?.answer ?? null, correct: answer?.correct ?? false };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null),
      failedTopics: [],
    };
  }

  // Провал: правильные ответы НЕ раскрываются — только список тем с ошибками.
  const topics = new Set<string>();
  for (const id of questionIds) {
    const question = byId.get(id);
    if (!question) continue;
    const answer = answerByQuestion.get(id);
    if (!answer || !answer.correct) {
      topics.add(question.category.parent?.title ?? question.category.title);
    }
  }
  return {
    attempt: {
      id: attempt.id,
      kind: attempt.kind,
      score: attempt.score,
      passed: false,
      finishedAt: attempt.finishedAt,
    },
    threshold,
    review: null,
    failedTopics: [...topics],
  };
}

/** Настройка теста модуля из контент-студии (spec 8.5). */
export async function upsertModuleTestConfig(
  db: PrismaClient,
  input: {
    actorId: string;
    moduleId: string;
    poolSize: number;
    threshold: number;
    cooldownMinutes: number;
    enabled: boolean;
  },
): Promise<{ ok: true } | { ok: false; code: "not_found" }> {
  const mod = await db.module.findUnique({ where: { id: input.moduleId } });
  if (!mod) return { ok: false, code: "not_found" };

  const existing = await db.moduleTest.findUnique({ where: { moduleId: mod.id } });
  const data = {
    poolSize: input.poolSize,
    threshold: input.threshold,
    cooldownMinutes: input.cooldownMinutes,
    enabled: input.enabled,
  };
  await db.moduleTest.upsert({
    where: { moduleId: mod.id },
    create: { moduleId: mod.id, ...data },
    update: data,
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "module_test.configured",
    entityType: "module",
    entityId: mod.id,
    before: existing
      ? {
          poolSize: existing.poolSize,
          threshold: existing.threshold,
          cooldownMinutes: existing.cooldownMinutes,
          enabled: existing.enabled,
        }
      : undefined,
    after: { ...data },
  });
  return { ok: true };
}
