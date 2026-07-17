#!/usr/bin/env node
/**
 * Portable PostgreSQL 16 manager for machines without Docker (see README).
 * Downloads the official EDB binaries zip into ./pgsql (gitignored), runs
 * initdb with the same credentials docker-compose.dev.yml uses, and wraps
 * pg_ctl for day-to-day start/stop/status.
 *
 * Commands: setup | start | stop | status
 */
import { spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// DECISION: pinned to the newest published 16.x EDB build at setup time;
// bump manually when needed — the data catalog survives minor upgrades.
const PG_VERSION = "16.14-1";
const PG_ZIP_URL = `https://get.enterprisedb.com/postgresql/postgresql-${PG_VERSION}-windows-x64-binaries.zip`;
// The zip's root folder is "pgsql", so extraction lands in ./pgsql.
const PG_DIR = path.join(ROOT, "pgsql");
const DATA_DIR = path.join(PG_DIR, "data");
const LOG_FILE = path.join(PG_DIR, "postgres.log");

// Must match DATABASE_URL in .env and docker-compose.dev.yml.
const DB = { host: "127.0.0.1", port: 5432, user: "mentors", password: "mentors", name: "mentors" };

const exe = (name) => path.join(PG_DIR, "bin", process.platform === "win32" ? `${name}.exe` : name);

function run(file, args, extraEnv = {}) {
  return spawnSync(file, args, {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, ...extraEnv },
  });
}

function fail(message) {
  console.error(`\x1b[31m${message}\x1b[0m`);
  process.exit(1);
}

function binariesPresent() {
  return existsSync(exe("pg_ctl"));
}

function dataPresent() {
  return existsSync(path.join(DATA_DIR, "PG_VERSION"));
}

function serverRunning() {
  if (!binariesPresent() || !dataPresent()) return false;
  return run(exe("pg_ctl"), ["status", "-D", DATA_DIR]).status === 0;
}

async function downloadBinaries() {
  console.log(`Скачиваю PostgreSQL ${PG_VERSION} (~326 МБ) — это разовая операция...`);
  const zipPath = path.join(os.tmpdir(), `postgresql-${PG_VERSION}-win-x64.zip`);
  const res = await fetch(PG_ZIP_URL);
  if (!res.ok || !res.body) {
    fail(
      `Не удалось скачать ${PG_ZIP_URL} (HTTP ${res.status}). Проверь сеть и повтори pnpm db:setup.`,
    );
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

  console.log("Распаковываю в ./pgsql ...");
  // bsdtar (ships with Windows 10+) extracts zip archives natively.
  let extract = run("tar", ["-xf", zipPath, "-C", ROOT]);
  if (extract.status !== 0) {
    extract = run("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${ROOT}' -Force`,
    ]);
  }
  rmSync(zipPath, { force: true });
  if (extract.status !== 0 || !binariesPresent()) {
    fail(`Не удалось распаковать архив: ${extract.stderr || extract.error?.message || "unknown"}`);
  }
  pruneDistribution();
  console.log("Бинарники готовы: ./pgsql/bin");
}

// The EDB zip bundles pgAdmin 4 / StackBuilder / docs (hundreds of MB and
// thousands of source files that confuse repo tooling). The server only needs
// bin + lib + share; everything else is removed.
const KEEP_IN_PG_DIR = new Set(["bin", "lib", "share", "data", "postgres.log"]);

function pruneDistribution() {
  for (const entry of readdirSync(PG_DIR)) {
    if (!KEEP_IN_PG_DIR.has(entry)) {
      rmSync(path.join(PG_DIR, entry), { recursive: true, force: true });
    }
  }
}

function initCluster() {
  console.log("Инициализирую data-каталог (initdb) ...");
  const pwFile = path.join(os.tmpdir(), `mentors-pg-pw-${process.pid}.txt`);
  writeFileSync(pwFile, `${DB.password}\n`, "utf8");
  try {
    const base = [
      "-D",
      DATA_DIR,
      "-U",
      DB.user,
      "-A",
      "scram-sha-256",
      `--pwfile=${pwFile}`,
      "-E",
      "UTF8",
    ];
    // LC_CTYPE MUST classify Cyrillic as letters, or pg_trgm extracts no trigrams
    // and the search typo-fallback (spec 7.11) silently returns nothing — under a
    // `C` locale `show_trgm('метрики')` is empty. So the cluster is initialised
    // with a Cyrillic-aware LC_CTYPE; LC_COLLATE stays `C` for deterministic,
    // cross-platform byte ordering (Windows dev ↔ Linux prod). See
    // mentors-dev-ops-notes. (FTS `russian` is dictionary-based and locale-safe.)
    const localeAttempts = [
      ["--lc-ctype=ru-RU", "--lc-collate=C"],
      ["--lc-ctype=Russian_Russia.utf8", "--lc-collate=C"],
    ];
    let res;
    let localed = false;
    for (const loc of localeAttempts) {
      res = run(exe("initdb"), [...base, ...loc]);
      if (res.status === 0) {
        localed = true;
        break;
      }
      rmSync(DATA_DIR, { recursive: true, force: true });
    }
    if (!localed) {
      // Last resort: C locale — the server runs, but the search typo-fallback is
      // degraded (silent). Prefer fixing the OS locale over shipping this.
      console.log(
        "Кириллическая LC_CTYPE недоступна — ставлю C (подсказки при опечатках в поиске работать не будут) ...",
      );
      res = run(exe("initdb"), [...base, "--locale=C"]);
    }
    if (res.status !== 0) {
      fail(`initdb завершился с ошибкой:\n${res.stderr || res.stdout}`);
    }
  } finally {
    rmSync(pwFile, { force: true });
  }
  console.log(`Кластер создан: ./pgsql/data (пользователь ${DB.user})`);
}

async function waitReady(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    const res = run(exe("pg_isready"), ["-h", DB.host, "-p", String(DB.port), "-t", "2"]);
    if (res.status === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function logTail(lines = 5) {
  try {
    return readFileSync(LOG_FILE, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function startServer() {
  // stdio "ignore": the postmaster inherits pg_ctl's handles — with piped stdio
  // it would keep the caller's stdout open forever (hangs pnpm/shell pipelines).
  const res = spawnSync(exe("pg_ctl"), ["start", "-D", DATA_DIR, "-l", LOG_FILE, "-w"], {
    stdio: "ignore",
    env: process.env,
  });
  if (res.status !== 0) {
    fail(`Не удалось запустить PostgreSQL:\n${logTail()}\nПолный лог: pgsql/postgres.log`);
  }
}

function stopServer() {
  const res = run(exe("pg_ctl"), ["stop", "-D", DATA_DIR, "-m", "fast", "-w"]);
  if (res.status !== 0) {
    fail(`Не удалось остановить PostgreSQL:\n${res.stderr || res.stdout}`);
  }
}

function ensureDatabase() {
  const env = { PGPASSWORD: DB.password };
  const check = run(
    exe("psql"),
    [
      "-h",
      DB.host,
      "-p",
      String(DB.port),
      "-U",
      DB.user,
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname='${DB.name}'`,
    ],
    env,
  );
  if (check.status !== 0) {
    fail(`Не удалось проверить наличие базы:\n${check.stderr}`);
  }
  if (check.stdout.trim() === "1") return;
  // Create from template0 with an explicit Cyrillic-aware LC_CTYPE so the search
  // typo-fallback works even on an already-`C` cluster (spec 7.11). LC_COLLATE=C
  // for deterministic byte order. See mentors-dev-ops-notes / initCluster.
  const base = ["-h", DB.host, "-p", String(DB.port), "-U", DB.user];
  let create = run(
    exe("createdb"),
    [
      ...base,
      "--template",
      "template0",
      "--encoding",
      "UTF8",
      "--lc-ctype",
      "ru-RU",
      "--lc-collate",
      "C",
      DB.name,
    ],
    env,
  );
  if (create.status !== 0) {
    // OS lacks a Cyrillic LC_CTYPE — fall back to the cluster default so setup
    // still succeeds (search FTS works; only the typo-fallback is degraded).
    console.log(
      "Кириллическая LC_CTYPE недоступна — создаю базу в locale кластера (подсказки при опечатках работать не будут) ...",
    );
    create = run(exe("createdb"), [...base, DB.name], env);
  }
  if (create.status !== 0) {
    fail(`Не удалось создать базу ${DB.name}:\n${create.stderr}`);
  }
  console.log(`База данных «${DB.name}» создана.`);
}

async function setup() {
  if (!binariesPresent()) {
    await downloadBinaries();
  } else {
    console.log("Бинарники уже на месте: ./pgsql/bin");
  }
  if (!dataPresent()) {
    initCluster();
  } else {
    console.log("Data-каталог уже инициализирован: ./pgsql/data");
  }

  const wasRunning = serverRunning();
  if (!wasRunning) startServer();
  if (!(await waitReady()))
    fail("PostgreSQL не отвечает на 127.0.0.1:5432 — смотри pgsql/postgres.log");
  ensureDatabase();
  if (!wasRunning) {
    stopServer();
    console.log("Готово. Запусти базу: pnpm db:start");
  } else {
    console.log("Готово. База уже запущена.");
  }
}

async function start() {
  if (!binariesPresent() || !dataPresent()) {
    fail("Портативный PostgreSQL ещё не установлен — сначала выполни pnpm db:setup");
  }
  if (serverRunning()) {
    console.log(`База уже запущена: postgresql://${DB.user}@${DB.host}:${DB.port}/${DB.name}`);
    return;
  }
  startServer();
  if (!(await waitReady()))
    fail("PostgreSQL стартовала, но не отвечает — смотри pgsql/postgres.log");
  console.log(`PostgreSQL 16 запущена: postgresql://${DB.user}@${DB.host}:${DB.port}/${DB.name}`);
}

function stop() {
  if (!serverRunning()) {
    console.log("База не запущена.");
    return;
  }
  stopServer();
  console.log("PostgreSQL остановлена.");
}

function status() {
  if (serverRunning()) {
    console.log(`База запущена: postgresql://${DB.user}@${DB.host}:${DB.port}/${DB.name}`);
    return;
  }
  console.log("База не запущена — выполни pnpm db:start");
  process.exitCode = 1;
}

const command = process.argv[2];
switch (command) {
  case "setup":
    await setup();
    break;
  case "start":
    await start();
    break;
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  default:
    console.log("Использование: node scripts/db.mjs <setup|start|stop|status>");
    process.exitCode = 1;
}
