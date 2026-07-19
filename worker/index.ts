import { schedule } from "node-cron";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runJob } from "@/worker/lib/run-job";
import { getLockClient } from "@/worker/lib/lock-client";
import { startHeartbeat } from "@/worker/lib/heartbeat";
import { JOBS } from "@/worker/registry";

// Worker process (spec 3/7.15): a long-lived node-cron scheduler for background
// jobs — slots, streaks, digests, reminders, monitors, email flush. Crons run in
// UTC; per-user time-zone logic lives inside each job. Every run is advisory-
// locked (spec «защита от параллельного запуска»), logs to stdout, and is
// idempotent so a restart between ticks self-heals. Run with `tsx worker/index.ts`.

const lockClient = getLockClient();
let stopHeartbeat: (() => void) | null = null;

function startWorker(): void {
  logger.info(
    { jobs: JOBS.map((job) => `${job.name} @ ${job.schedule}`) },
    "worker starting — scheduling jobs (UTC)",
  );
  // Liveness signal for the Docker healthcheck (spec 12.2/4.1).
  stopHeartbeat = startHeartbeat();
  for (const job of JOBS) {
    // RETURN the promise (not `void`): node-cron's noOverlap awaits it to skip a
    // tick while the previous run is still pending — the same-process guard.
    schedule(job.schedule, () => runJob(lockClient, job.name, () => job.run(prisma)), {
      timezone: "UTC",
      noOverlap: true,
    });
  }
  logger.info({ count: JOBS.length }, "worker ready");
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "worker shutting down");
  stopHeartbeat?.();
  await Promise.allSettled([prisma.$disconnect(), lockClient.$disconnect()]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

startWorker();
