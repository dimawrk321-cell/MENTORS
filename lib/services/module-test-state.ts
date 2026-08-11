import type { ModuleTest } from "@prisma/client";
import type { Db } from "@/lib/db";
import { CLOSED_QUESTION_TYPES } from "@/lib/utils/answers";

// Состояние модульных тестов для гейтинга (spec 7.3/7.5) — вынесено ИЗ tests.ts
// дословно. Причина та же, что у gating.ts: расчёт «пройден ли курс» нужен
// доступу к банку вопросов, а tests.ts тянет srs.ts, который зависит от
// question-access. Здесь только чтение состояния — ни событий, ни мутаций,
// поэтому лист ни от чего из сервисов не зависит; tests.ts реэкспортирует эти
// три имени и остаётся точкой входа для всех прежних импортов.

export interface ModuleTestState {
  test: ModuleTest;
  passed: boolean;
  /** Score of the best PASSED attempt (module or testout) — «сдан {score}%». */
  bestPassedScore: number | null;
  /** Closed published questions available to this test — 0 means it cannot be sat. */
  poolCount: number;
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

  const [passedAttempts, poolLinks] = await Promise.all([
    db.testAttempt.findMany({
      where: { userId, moduleId: { in: moduleIds }, passed: true },
      select: { moduleId: true, score: true },
    }),
    // Same filter as getModuleQuestionPool — an enabled test with an empty pool
    // cannot be started (startTestAttempt returns `no_questions`), so it must
    // not be allowed to gate anything (see makeModuleTestHook below).
    db.questionLesson.findMany({
      where: {
        lesson: { moduleId: { in: moduleIds }, status: "published" },
        question: { status: "published", type: { in: [...CLOSED_QUESTION_TYPES] } },
      },
      select: { questionId: true, lesson: { select: { moduleId: true } } },
    }),
  ]);
  const bestByModule = new Map<string, number>();
  for (const attempt of passedAttempts) {
    const best = bestByModule.get(attempt.moduleId);
    if (best === undefined || attempt.score > best) {
      bestByModule.set(attempt.moduleId, attempt.score);
    }
  }
  const poolByModule = new Map<string, Set<string>>();
  for (const link of poolLinks) {
    const moduleId = link.lesson.moduleId;
    const set = poolByModule.get(moduleId) ?? new Set<string>();
    set.add(link.questionId);
    poolByModule.set(moduleId, set);
  }

  return new Map(
    tests.map((test) => [
      test.moduleId,
      {
        test,
        passed: bestByModule.has(test.moduleId),
        bestPassedScore: bestByModule.get(test.moduleId) ?? null,
        poolCount: poolByModule.get(test.moduleId)?.size ?? 0,
      },
    ]),
  );
}

/**
 * Gating hook (spec 7.3): a module counts as tested unless an enabled test is
 * unpassed.
 *
 * An enabled test with an EMPTY pool counts as tested. `startTestAttempt`
 * refuses to create an attempt without questions (`no_questions`), so such a
 * test can never be passed — treating it as a wall dead-ends the module, and
 * under the hard chain (block 2v2) that dead-ends every course after it for the
 * whole cohort. A test nobody can sit is not a requirement.
 */
export function makeModuleTestHook(
  states: Map<string, ModuleTestState>,
): (moduleId: string) => boolean {
  return (moduleId) => {
    const state = states.get(moduleId);
    if (!state || !state.test.enabled) return true;
    if (state.poolCount === 0) return true;
    return state.passed;
  };
}
