import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { Prisma, ImportRunStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { writeAudit } from "@/lib/services/audit";
import { withAdvisoryLock } from "@/worker/lib/advisory-lock";
import { IMPORT_MAX_MD_MB, IMPORT_MAX_ZIP_MB } from "@/lib/constants";
import { runImport } from "./runner";
import { extractImagesFromZip } from "./zip";
import type { CommitResult } from "./commit";
import type { ImportAnomalies } from "./types";

// Admin /admin/import execution service (spec 7.14 / 8.5). The web action calls
// createImportRun → writes the upload to a temp dir OUTSIDE the repo → launches
// runImportJob (detached, in-process) → the page polls the run row. Concurrency
// is denied by the Postgres advisory lock «notion-import» (the hard cross-process
// guard) plus an active-row pre-check for immediate UX + dead-run recovery.
//
// DECISION (spec 7.14 «выполнение в отдельном процессе или с разумным таймаутом»):
// the import runs IN-PROCESS, not as a spawned child — it reuses the exact CLI
// service code (runImport), and the production image has no `tsx` to spawn the
// TS script with, nor should a child re-open the DB pool. Robustness instead
// comes from (1) the session-level advisory lock, which Postgres auto-releases
// if the process dies, and (2) IMPORT_STALE_MINUTES: an unfinished run older
// than this is treated as abandoned, so a crashed job never blocks new imports
// forever. That staleness bound IS the «разумный таймаут». Suits self-hosted
// `next start` (a long-lived Node server); the detached job is not for serverless.

/** Advisory-lock name — one import at a time across every process (spec 7.14). */
export const IMPORT_LOCK_NAME = "notion-import";

const MAX_MD_BYTES = IMPORT_MAX_MD_MB * 1024 * 1024;
const MAX_ZIP_BYTES = IMPORT_MAX_ZIP_MB * 1024 * 1024;

/** An unfinished run older than this is treated as abandoned (the timeout bound). */
export const IMPORT_STALE_MINUTES = 15;

const IMPORT_MD_NAME = "export.md";
const IMPORT_IMAGES_SUBDIR = "images";
const IMPORT_TMP_PREFIX = "mentors-import-";

const ACTIVE_STATUSES: ImportRunStatus[] = ["pending", "parsing", "planning", "committing"];

// --- Persisted run counts (spec 8.5: «счётчики json») ---

export interface ImportAnomalyCounts {
  questionsAtSubcategoryLevel: number;
  unrecognizedCategoryLinks: number;
  needsLatex: number;
  todoImages: number;
  skippedSections: number;
  createdNonSeedRootCategories: number;
}

export interface ImportRunCounts {
  result: CommitResult;
  images: { copied: number; missing: number };
  anomalies: ImportAnomalyCounts;
}

function summarizeAnomalies(a: ImportAnomalies): ImportAnomalyCounts {
  return {
    questionsAtSubcategoryLevel: a.questionsAtSubcategoryLevel.length,
    unrecognizedCategoryLinks: a.unrecognizedCategoryLinks.length,
    needsLatex: a.needsLatexQuestions.length,
    todoImages: a.todoImages.length,
    skippedSections: a.skippedSections.length,
    createdNonSeedRootCategories: a.createdNonSeedRootCategories.length,
  };
}

function totalAnomalies(a: ImportAnomalyCounts): number {
  return Object.values(a).reduce((sum, n) => sum + n, 0);
}

// --- File validation (spec 7.14 «файл валидируется: markdown, размер») ---

export interface FileValidation {
  ok: boolean;
  /** Ready-to-toast Russian message when ok=false. */
  message?: string;
}

/** Validates the export .md upload: extension, non-empty, size cap, is-text. */
export function validateImportFile(input: {
  name: string;
  size: number;
  buffer?: Buffer;
}): FileValidation {
  const name = input.name.trim();
  if (!/\.md$/i.test(name)) return { ok: false, message: "Нужен markdown-файл экспорта (.md)" };
  if (input.size <= 0) return { ok: false, message: "Файл пустой" };
  if (input.size > MAX_MD_BYTES) {
    return { ok: false, message: `Файл больше ${IMPORT_MAX_MD_MB} МБ` };
  }
  if (input.buffer) {
    // Binary heuristic: a NUL byte in the first 8 KiB means it isn't text markdown.
    if (input.buffer.subarray(0, 8192).includes(0)) {
      return { ok: false, message: "Похоже, это не текстовый markdown-файл" };
    }
  }
  return { ok: true };
}

/** Validates the optional image archive upload: extension and size cap. */
export function validateImportZip(input: { name: string; size: number }): FileValidation {
  if (!/\.zip$/i.test(input.name.trim())) {
    return { ok: false, message: "Архив с картинками должен быть .zip" };
  }
  if (input.size > MAX_ZIP_BYTES) {
    return { ok: false, message: `Архив больше ${IMPORT_MAX_ZIP_MB} МБ` };
  }
  return { ok: true };
}

// --- Temp files (spec 7.14 «временный каталог вне git, после импорта удаляется») ---

/** Per-run scratch dir under the OS temp root — never inside the repo/git tree. */
export function importTempDir(runId: string): string {
  return path.join(os.tmpdir(), `${IMPORT_TMP_PREFIX}${runId}`);
}

/**
 * Writes the validated upload into the run's temp dir (export.md + optional
 * extracted images). Returns how many images the zip yielded.
 */
export function writeImportInputs(
  runId: string,
  inputs: { markdown: Buffer; zip?: Buffer | null },
): { imagesExtracted: number } {
  const tmpDir = importTempDir(runId);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, IMPORT_MD_NAME), inputs.markdown);
  let imagesExtracted = 0;
  if (inputs.zip && inputs.zip.length > 0) {
    const out = extractImagesFromZip(inputs.zip, path.join(tmpDir, IMPORT_IMAGES_SUBDIR));
    imagesExtracted = out.extracted;
  }
  return { imagesExtracted };
}

/** Removes the run's temp dir (best effort — a leftover must never break a run). */
export function cleanupImportTempDir(runId: string): void {
  try {
    fs.rmSync(importTempDir(runId), { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err, runId }, "import temp cleanup failed");
  }
}

// --- Run rows (spec 8.5: import_runs history) ---

/** True while an import is running (and hasn't gone stale) — blocks a new start. */
export async function hasActiveImportRun(db: Db, now: Date = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - IMPORT_STALE_MINUTES * 60_000);
  const active = await db.importRun.findFirst({
    where: { status: { in: ACTIVE_STATUSES }, startedAt: { gt: cutoff } },
    select: { id: true },
  });
  return active !== null;
}

export async function createImportRun(
  db: Db,
  input: { actorId: string; fileName: string; fileSize: number; dryRun: boolean },
): Promise<{ id: string }> {
  return db.importRun.create({
    data: {
      actorId: input.actorId,
      fileName: input.fileName,
      fileSize: input.fileSize,
      dryRun: input.dryRun,
      status: "pending",
    },
    select: { id: true },
  });
}

export interface ImportRunListItem {
  id: string;
  fileName: string;
  fileSize: number;
  dryRun: boolean;
  status: ImportRunStatus;
  actorName: string;
  anomaliesCount: number;
  counts: ImportRunCounts | null;
  report: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

function toListItem(row: {
  id: string;
  fileName: string;
  fileSize: number;
  dryRun: boolean;
  status: ImportRunStatus;
  anomaliesCount: number;
  counts: unknown;
  report: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  actor: { name: string };
}): ImportRunListItem {
  return {
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    dryRun: row.dryRun,
    status: row.status,
    actorName: row.actor.name,
    anomaliesCount: row.anomaliesCount,
    counts: (row.counts as ImportRunCounts | null) ?? null,
    report: row.report,
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

/** Recent runs for the /admin/import history list (spec 8.5). */
export async function listImportRuns(db: Db, limit = 20): Promise<ImportRunListItem[]> {
  const rows = await db.importRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true } } },
  });
  return rows.map(toListItem);
}

/** Single run — for status polling. */
export async function getImportRun(db: Db, id: string): Promise<ImportRunListItem | null> {
  const row = await db.importRun.findUnique({
    where: { id },
    include: { actor: { select: { name: true } } },
  });
  return row ? toListItem(row) : null;
}

async function failRun(db: Db, runId: string, message: string): Promise<void> {
  try {
    await db.importRun.update({
      where: { id: runId },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
  } catch (err) {
    logger.error({ err, runId }, "failed to mark import run as error");
  }
}

// --- The job (spec 7.14: same codebase as CLI, advisory-locked) ---

/**
 * Fresh single-connection client for ONE run's advisory lock. A per-run session
 * is mandatory: session-level pg advisory locks are RE-ENTRANT, so a shared /
 * memoized connection (like the worker's getLockClient) would let two same-process
 * imports both acquire the lock — the guard would silently fail. A distinct session
 * per run makes the lock truly serialize concurrent imports, same- or cross-process.
 */
function makeImportLockClient(): PrismaClient {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for the import lock client");
  const url = new URL(raw);
  url.searchParams.set("connection_limit", "1");
  return new PrismaClient({ datasourceUrl: url.toString() });
}

export interface RunImportJobDeps {
  db: Db;
  /**
   * Dedicated single-connection client for the advisory lock. Omit in production —
   * the job makes a fresh per-run session (see makeImportLockClient) and disconnects
   * it. Tests inject one (they own its lifecycle) to simulate a specific session.
   */
  lockDb?: PrismaClient;
}

export interface RunImportJobParams {
  runId: string;
  dryRun: boolean;
  /** Original uploaded filename — the report header + audit record. */
  fileLabel: string;
  actorId: string;
}

/**
 * Executes one import run: acquire the advisory lock, stream status through the
 * run row, call the shared runImport (same code as the CLI), persist counts +
 * report, audit `import.executed`, and always clean up the temp dir. Never
 * throws out — failures land in the run row so the page can show them.
 */
export async function runImportJob(
  deps: RunImportJobDeps,
  params: RunImportJobParams,
): Promise<{ ran: boolean }> {
  const { db } = deps;
  const { runId } = params;
  const tmpDir = importTempDir(runId);
  const mdPath = path.join(tmpDir, IMPORT_MD_NAME);
  const imagesDir = path.join(tmpDir, IMPORT_IMAGES_SUBDIR);
  const hasImages = fs.existsSync(imagesDir);

  // A caller-supplied lockDb is borrowed (tests own it); otherwise make + own one.
  // Created inside the try so a client-init failure marks the run instead of leaving
  // it stuck; declared here so the finally can disconnect an owned session.
  const ownsLock = !deps.lockDb;
  let lockDb: PrismaClient | null = deps.lockDb ?? null;

  try {
    if (!lockDb) lockDb = makeImportLockClient();
    const outcome = await withAdvisoryLock(lockDb, IMPORT_LOCK_NAME, async () => {
      const markdown = fs.readFileSync(mdPath, "utf8");
      const { result, report, plan, imagesCopied, imagesMissing } = await runImport({
        db,
        markdown,
        imagesDir: hasImages ? imagesDir : null,
        dryRun: params.dryRun,
        fileLabel: params.fileLabel,
        onPhase: async (phase) => {
          await db.importRun.update({ where: { id: runId }, data: { status: phase } });
        },
      });

      const anomalies = summarizeAnomalies(plan.anomalies);
      const counts: ImportRunCounts = {
        result,
        images: { copied: imagesCopied, missing: imagesMissing },
        anomalies,
      };
      await db.importRun.update({
        where: { id: runId },
        data: {
          status: "done",
          counts: counts as unknown as Prisma.InputJsonValue,
          anomaliesCount: totalAnomalies(anomalies),
          report,
          finishedAt: new Date(),
        },
      });
      // Audit `import.executed` (spec 7.14: файл, dry_run, счётчики).
      await writeAudit(db, {
        actorId: params.actorId,
        action: "import.executed",
        entityType: "import_run",
        entityId: runId,
        after: {
          file: params.fileLabel,
          dryRun: params.dryRun,
          counts: counts as unknown as Prisma.InputJsonValue,
        },
      });
    });

    if (!outcome.ran) {
      // Another process holds the lock — a truly concurrent run.
      await failRun(db, runId, "Импорт уже выполняется — дождись завершения");
      return { ran: false };
    }
    return { ran: true };
  } catch (err) {
    logger.error({ err, runId }, "import run failed");
    await failRun(db, runId, "Импорт не удался — проверь файл экспорта и попробуй ещё раз");
    return { ran: true };
  } finally {
    // Security (spec 7.14): the uploaded file lives only for the run.
    cleanupImportTempDir(runId);
    // Disconnecting our own lock session releases any advisory lock it still holds.
    if (ownsLock && lockDb) await lockDb.$disconnect().catch(() => {});
  }
}
