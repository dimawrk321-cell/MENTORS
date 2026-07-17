import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { withAdvisoryLock } from "@/worker/lib/advisory-lock";

// Uniform job runner (spec 7.15): advisory-locked, stdout-logged, never throws
// out (a failing job must not crash the worker process). Idempotent job bodies
// mean a missed tick after a restart self-heals on the next run.

export async function runJob(
  lockDb: PrismaClient,
  name: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const outcome = await withAdvisoryLock(lockDb, name, fn);
    if (!outcome.ran) {
      logger.info({ job: name }, "job skipped — lock held by another run");
      return;
    }
    logger.info(
      { job: name, ms: Date.now() - startedAt, result: outcome.result ?? null },
      "job done",
    );
  } catch (err) {
    logger.error({ job: name, ms: Date.now() - startedAt, err }, "job failed");
  }
}
