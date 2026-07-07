#!/usr/bin/env node
/**
 * Preflight for `pnpm dev`: verifies the PostgreSQL from DATABASE_URL accepts
 * TCP connections and prints an actionable russian error if it does not.
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function targetFromEnv() {
  const fallback = { host: "127.0.0.1", port: 5432 };
  let raw = process.env.DATABASE_URL;
  if (!raw) {
    try {
      const env = readFileSync(path.join(ROOT, ".env"), "utf8");
      raw = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m.exec(env)?.[1]?.replace(/^["']|["']$/g, "");
    } catch {
      return fallback;
    }
  }
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    return { host: url.hostname || fallback.host, port: Number(url.port) || fallback.port };
  } catch {
    return fallback;
  }
}

const { host, port } = targetFromEnv();

const socket = net.createConnection({ host, port, timeout: 1500 });

socket.once("connect", () => {
  socket.destroy();
  process.exit(0);
});

const onFail = () => {
  socket.destroy();
  console.error(`\x1b[31mБаза не запущена — выполни pnpm db:start\x1b[0m (нет соединения с ${host}:${port})`);
  process.exit(1);
};

socket.once("error", onFail);
socket.once("timeout", onFail);
