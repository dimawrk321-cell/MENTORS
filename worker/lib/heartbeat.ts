import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "@/lib/logger";

// Worker heartbeat (spec 12.2/4.1): the scheduler process has no port, so Docker
// can't judge health by a TCP probe — a node-cron process is "Up" even if the
// event loop is wedged. Instead the worker touches a file on a fixed interval and
// the Docker healthcheck (worker/healthcheck.mjs) reads its freshness. A frozen
// loop stops updating the file → the container turns honestly `unhealthy`.

/** Heartbeat file path — shared by the writer and the healthcheck reader. */
export const HEARTBEAT_FILE =
  process.env.WORKER_HEARTBEAT_FILE ?? path.join(os.tmpdir(), "mentors-worker-heartbeat");

/** Write interval; the healthcheck's staleness window is a few of these. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

function touch(): void {
  try {
    writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch (err) {
    // Never let a heartbeat write crash the worker — just log and retry next tick.
    logger.warn({ err, file: HEARTBEAT_FILE }, "heartbeat write failed");
  }
}

/**
 * Start touching the heartbeat file. Writes once immediately (so the container is
 * healthy as soon as the loop is live) and then every HEARTBEAT_INTERVAL_MS.
 * Returns a stop function for graceful shutdown.
 */
export function startHeartbeat(intervalMs = HEARTBEAT_INTERVAL_MS): () => void {
  touch();
  const timer = setInterval(touch, intervalMs);
  // Do not keep the process alive solely for the heartbeat.
  timer.unref?.();
  logger.info({ file: HEARTBEAT_FILE, intervalMs }, "heartbeat started");
  return () => clearInterval(timer);
}
