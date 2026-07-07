import { execSync, spawnSync } from "node:child_process";
import net from "node:net";
import { testDatabaseUrl } from "./helpers/db-url";

// Vitest global setup: stage-1 business-logic suites run against a real
// PostgreSQL (portable ./pgsql) using a separate `mentors_test` database.
// Ensures the server is up (starts it if not) and syncs the schema.

function tcpCheck(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once("error", fail);
    socket.once("timeout", fail);
  });
}

export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const host = url.hostname || "127.0.0.1";
  const port = Number(url.port) || 5432;

  if (!(await tcpCheck(host, port))) {
    // Same behaviour the user gets from `pnpm db:start`.
    spawnSync("node", ["scripts/db.mjs", "start"], { stdio: "inherit" });
    if (!(await tcpCheck(host, port))) {
      throw new Error(
        `База не запущена (нет соединения с ${host}:${port}) — выполни pnpm db:start`,
      );
    }
  }

  // Creates mentors_test on first run and syncs the Prisma schema after.
  execSync("pnpm prisma db push --skip-generate --accept-data-loss", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
