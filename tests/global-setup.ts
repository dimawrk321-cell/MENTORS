import { execSync, spawnSync } from "node:child_process";
import net from "node:net";
import { PrismaClient } from "@prisma/client";
import { testDatabaseUrl } from "./helpers/db-url";

// Vitest global setup: business-logic suites run against a real PostgreSQL
// (portable ./pgsql) using a separate `mentors_test` database. Ensures the
// server is up, (re)creates the test DB with a Cyrillic-aware LC_CTYPE, syncs
// the Prisma schema, and installs the FTS triggers Prisma can't express.

const TEST_DB = "mentors_test";
// Stage 8: pg_trgm keys word-char detection off LC_CTYPE. Under `C` it extracts
// no Cyrillic trigrams, so the trgm fallback (and its test) can't work. Force a
// Cyrillic-aware ctype for the test DB; UTF8 encoding + `C` collation keep byte
// ordering stable. (FTS `russian` is dictionary-based and unaffected by this.)
const TEST_DB_CTYPE = "ru-RU";

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

/** Admin connection URL (same server, the default `mentors` DB) for DDL on TEST_DB. */
function adminUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.pathname = "/mentors";
  return url.toString();
}

/** (Re)create TEST_DB with the Cyrillic-aware ctype if missing or wrong. */
async function ensureTestDatabase(): Promise<void> {
  const admin = new PrismaClient({ datasourceUrl: adminUrl() });
  try {
    const rows = await admin.$queryRawUnsafe<{ datctype: string }[]>(
      `SELECT datctype FROM pg_database WHERE datname = '${TEST_DB}'`,
    );
    const current = rows[0]?.datctype ?? null;
    if (current === TEST_DB_CTYPE) return;

    // Missing or wrong ctype → drop (terminating stragglers) and recreate.
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
    await admin.$executeRawUnsafe(
      `CREATE DATABASE "${TEST_DB}" TEMPLATE template0 ENCODING 'UTF8'
       LC_CTYPE '${TEST_DB_CTYPE}' LC_COLLATE 'C'`,
    );
  } finally {
    await admin.$disconnect();
  }
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

  await ensureTestDatabase();

  const env = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  // Syncs the Prisma schema (columns, GIN indexes, pg_trgm extension).
  execSync("pnpm prisma db push --skip-generate --accept-data-loss", { stdio: "pipe", env });
  // Installs the FTS trigger functions/triggers Prisma can't express (stage 8).
  execSync(
    "pnpm prisma db execute --file prisma/sql/search-triggers.sql --schema prisma/schema.prisma",
    { stdio: "pipe", env },
  );
}
