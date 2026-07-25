import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isApiRateLimited } from "@/lib/utils/rate-limit";
import { signalOwner } from "@/lib/services/telegram/owner-signals";
import { withAdvisoryLock } from "@/worker/lib/advisory-lock";

/** Owner job-error signal cap (spec 13.3 block 4): at most 1/hour per job type. */
const JOB_ERROR_SIGNAL_WINDOW_MS = 60 * 60 * 1000;

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
    // Owner signal (walk 13.3 block 4): push a job failure at most 1/hour per type.
    if (!isApiRateLimited(`owner_signal:job_error:${name}`, 1, JOB_ERROR_SIGNAL_WINDOW_MS)) {
      const message = err instanceof Error ? err.message : String(err);
      await signalOwner(prisma, { kind: "job_error", jobName: name, message }).catch(() => {});
    }
  }
}
