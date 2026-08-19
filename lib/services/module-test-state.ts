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

/**
 * Размер фактического пула по модулям — то же условие, что у
 * `getModuleQuestionPool`, но пачкой (заход C.1).
 *
 * Вынесено, потому что счётчик понадобился третьему потребителю: гейтингу
 * (здесь), ученической странице теста и — с захода C.1 — диалогу теста в
 * контент-студии, где ментор впервые видит, сколько вопросов у теста РЕАЛЬНО
 * есть против `pool_size`, то есть сколько он просит взять. Третья копия
 * where-клаузы была бы третьим местом, где правило может разъехаться.
 */
export async function getModulePoolCounts(
  db: Db,
  moduleIds: string[],
): Promise<Map<string, number>> {
  if (moduleIds.length === 0) return new Map();
  const poolLinks = await db.questionLesson.findMany({
    where: {
      lesson: { moduleId: { in: moduleIds }, status: "published" },
      question: { status: "published", type: { in: [...CLOSED_QUESTION_TYPES] } },
    },
    select: { questionId: true, lesson: { select: { moduleId: true } } },
  });
  const byModule = new Map<string, Set<string>>();
  for (const link of poolLinks) {
    const moduleId = link.lesson.moduleId;
    const set = byModule.get(moduleId) ?? new Set<string>();
    set.add(link.questionId);
    byModule.set(moduleId, set);
  }
  return new Map([...byModule].map(([moduleId, set]) => [moduleId, set.size]));
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

  const [passedAttempts, poolByModule] = await Promise.all([
    db.testAttempt.findMany({
      where: { userId, moduleId: { in: moduleIds }, passed: true },
      select: { moduleId: true, score: true },
    }),
    // An enabled test with an EMPTY pool cannot be started (startTestAttempt
    // returns `no_questions`), so it must not be allowed to gate anything —
    // see makeModuleTestHook below.
    getModulePoolCounts(db, moduleIds),
  ]);
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
        poolCount: poolByModule.get(test.moduleId) ?? 0,
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
