// Docker healthcheck for the worker container (spec 12.2/4.1). Plain Node (no
// tsx / no @/ imports) so it runs as a lightweight `node worker/healthcheck.mjs`
// probe. Reads the heartbeat file the worker touches every 30s and exits 0 only
// while it is fresh; a wedged or dead event loop lets it go stale → unhealthy.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Must match worker/lib/heartbeat.ts (same env var + default path).
const FILE =
  process.env.WORKER_HEARTBEAT_FILE ?? path.join(os.tmpdir(), "mentors-worker-heartbeat");
// Allow a few missed 30s writes before declaring the worker unhealthy.
const STALE_MS = 100_000;

try {
  const ts = Number.parseInt(readFileSync(FILE, "utf8").trim(), 10);
  const age = Date.now() - ts;
  if (!Number.isFinite(ts) || age > STALE_MS) {
    console.error(`worker heartbeat stale: age=${Number.isFinite(ts) ? age : "n/a"}ms`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error(`worker heartbeat unreadable: ${err.message}`);
  process.exit(1);
}
