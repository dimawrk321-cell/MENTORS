import fs from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { testDatabaseUrl } from "./helpers/db-url";
import { withAdvisoryLock } from "@/worker/lib/advisory-lock";
import {
  IMPORT_LOCK_NAME,
  createImportRun,
  getImportRun,
  hasActiveImportRun,
  importTempDir,
  runImportJob,
  validateImportFile,
  validateImportZip,
  writeImportInputs,
} from "@/lib/services/notion-import/admin-import";

// /admin/import service (spec 7.14 / 8.5): upload validation, the advisory-locked
// job that reuses the CLI import code, the import_runs history row + audit, and
// the parallel-run guard. Same fixture as the CLI importer test.

const IMPORT_FIXTURE = [
  "- **Спринты (основное обучение)**",
  "  - **Python + PyTorch**",
  "    - **Базовый синтаксис**",
  "",
  "      Тело урока про синтаксис.",
  "",
  "      **Категории вопросов для заучивания в базе:** Списки",
  "",
  "      **Проверка себя:** объясни изменяемость списка.",
  "- **Вопросы с собеседований**",
  "  - **Техническое собеседование**",
  "    - **Python**",
  "      - **Списки**",
  "        - **Что такое список?**",
  "",
  "          Список — изменяемая коллекция.",
].join("\n");

function singleConnectionClient(): PrismaClient {
  const url = new URL(testDatabaseUrl());
  url.searchParams.set("connection_limit", "1");
  return new PrismaClient({ datasourceUrl: url.toString() });
}

describe("validateImportFile / validateImportZip (spec 7.14: файл валидируется)", () => {
  it("accepts a normal markdown upload", () => {
    const r = validateImportFile({ name: "export.md", size: 1000, buffer: Buffer.from("# hi") });
    expect(r.ok).toBe(true);
  });

  it("rejects a non-md extension", () => {
    const r = validateImportFile({ name: "export.txt", size: 10 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/markdown/i);
  });

  it("rejects an empty file", () => {
    expect(validateImportFile({ name: "x.md", size: 0 }).ok).toBe(false);
  });

  it("rejects an oversized file (> 25 MB)", () => {
    expect(validateImportFile({ name: "x.md", size: 26 * 1024 * 1024 }).ok).toBe(false);
  });

  it("rejects a binary file (NUL byte in the head)", () => {
    const buf = Buffer.from([0x23, 0x20, 0x00, 0x23]);
    expect(validateImportFile({ name: "x.md", size: buf.length, buffer: buf }).ok).toBe(false);
  });

  it("zip must be .zip and within the size cap", () => {
    expect(validateImportZip({ name: "images.zip", size: 1000 }).ok).toBe(true);
    expect(validateImportZip({ name: "images.rar", size: 1000 }).ok).toBe(false);
    expect(validateImportZip({ name: "images.zip", size: 200 * 1024 * 1024 }).ok).toBe(false);
  });
});

describe("runImportJob — import_runs history + audit + lock (spec 7.14/8.5)", () => {
  const lockDb = singleConnectionClient();

  afterAll(async () => {
    await lockDb.$disconnect();
  });

  beforeEach(async () => {
    await resetDb();
  });

  async function stageRun(actorId: string, dryRun: boolean): Promise<{ id: string }> {
    const run = await createImportRun(testDb, {
      actorId,
      fileName: "export.md",
      fileSize: IMPORT_FIXTURE.length,
      dryRun,
    });
    writeImportInputs(run.id, { markdown: Buffer.from(IMPORT_FIXTURE, "utf8") });
    return run;
  }

  it("commit: writes a done row with counts + report, audits, cleans the temp dir", async () => {
    const admin = await createTestUser({ email: "imp-admin@x.io", role: "admin" });
    const run = await stageRun(admin.id, false);

    const outcome = await runImportJob(
      { db: testDb, lockDb },
      { runId: run.id, dryRun: false, fileLabel: "export.md", actorId: admin.id },
    );
    expect(outcome.ran).toBe(true);

    const row = await getImportRun(testDb, run.id);
    expect(row?.status).toBe("done");
    expect(row?.counts?.result.lessons.created).toBe(1);
    expect(row?.counts?.result.questions.created).toBe(1);
    expect(row?.report).toContain("Отчёт импортера");
    expect(row?.finishedAt).not.toBeNull();

    // Content really landed (same service as the CLI).
    expect(await testDb.lesson.count()).toBe(1);

    // Temp upload deleted after the run (security, spec 7.14).
    expect(fs.existsSync(importTempDir(run.id))).toBe(false);

    // Audit import.executed with file + dry_run flag (spec 7.14).
    const audit = await testDb.auditLog.findFirst({
      where: { action: "import.executed", entityId: run.id },
    });
    expect(audit).not.toBeNull();
    const after = audit!.after as unknown as { file: string; dryRun: boolean };
    expect(after.file).toBe("export.md");
    expect(after.dryRun).toBe(false);
  });

  it("dry-run: done row but nothing written to content tables", async () => {
    const admin = await createTestUser({ email: "imp-admin2@x.io", role: "admin" });
    const run = await stageRun(admin.id, true);

    await runImportJob(
      { db: testDb, lockDb },
      { runId: run.id, dryRun: true, fileLabel: "export.md", actorId: admin.id },
    );

    const row = await getImportRun(testDb, run.id);
    expect(row?.status).toBe("done");
    expect(row?.dryRun).toBe(true);
    expect(await testDb.lesson.count()).toBe(0); // dry-run wrote nothing
    expect(await testDb.question.count()).toBe(0);
  });

  it("parallel guard: a run started while the lock is held errors and imports nothing", async () => {
    const admin = await createTestUser({ email: "imp-admin3@x.io", role: "admin" });
    const run = await stageRun(admin.id, false);
    const holder = singleConnectionClient();

    try {
      // Hold the import lock on a separate session, then run the job on `lockDb`.
      const held = await withAdvisoryLock(holder, IMPORT_LOCK_NAME, async () => {
        const outcome = await runImportJob(
          { db: testDb, lockDb },
          { runId: run.id, dryRun: false, fileLabel: "export.md", actorId: admin.id },
        );
        expect(outcome.ran).toBe(false); // could not acquire the lock
        return "held";
      });
      expect(held.ran).toBe(true);
    } finally {
      await holder.$disconnect();
    }

    const row = await getImportRun(testDb, run.id);
    expect(row?.status).toBe("error");
    expect(await testDb.lesson.count()).toBe(0); // nothing imported under contention
    expect(fs.existsSync(importTempDir(run.id))).toBe(false); // temp still cleaned
  });

  it("hasActiveImportRun sees a fresh run, ignores a stale one", async () => {
    const admin = await createTestUser({ email: "imp-admin4@x.io", role: "admin" });
    const run = await createImportRun(testDb, {
      actorId: admin.id,
      fileName: "e.md",
      fileSize: 10,
      dryRun: false,
    });
    expect(await hasActiveImportRun(testDb)).toBe(true);

    // Age it past the stale threshold → no longer blocks a new import.
    await testDb.importRun.update({
      where: { id: run.id },
      data: { startedAt: new Date(Date.now() - 20 * 60_000) },
    });
    expect(await hasActiveImportRun(testDb)).toBe(false);
  });
});
