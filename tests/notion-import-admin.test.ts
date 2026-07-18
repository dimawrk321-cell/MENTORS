import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import { testDatabaseUrl } from "./helpers/db-url";
import { withAdvisoryLock } from "@/worker/lib/advisory-lock";
import {
  IMPORT_LOCK_NAME,
  createImportRun,
  getImportRun,
  importTempDir,
  isImportLockHeld,
  markStaleActiveRunsFailed,
  runImportJob,
  validateImportFile,
  validateImportZip,
  writeImportInputs,
} from "@/lib/services/notion-import/admin-import";
import { extractImagesFromZip, ImportZipError } from "@/lib/services/notion-import/zip";

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

  it("concurrent race: two jobs launched at once → exactly one imports, one errors", async () => {
    const admin = await createTestUser({ email: "imp-race@x.io", role: "admin" });
    const runA = await stageRun(admin.id, false);
    const runB = await stageRun(admin.id, false);

    // Two distinct lock sessions (as production gives each run its own session).
    const lockA = singleConnectionClient();
    const lockB = singleConnectionClient();
    let outcomes: { ran: boolean }[];
    try {
      outcomes = await Promise.all([
        runImportJob(
          { db: testDb, lockDb: lockA },
          { runId: runA.id, dryRun: false, fileLabel: "a.md", actorId: admin.id },
        ),
        runImportJob(
          { db: testDb, lockDb: lockB },
          { runId: runB.id, dryRun: false, fileLabel: "b.md", actorId: admin.id },
        ),
      ]);
    } finally {
      await Promise.allSettled([lockA.$disconnect(), lockB.$disconnect()]);
    }

    // Exactly one job acquired the lock and ran; the other was rejected.
    expect(outcomes.filter((o) => o.ran).length).toBe(1);
    expect(outcomes.filter((o) => !o.ran).length).toBe(1);

    const rows = [await getImportRun(testDb, runA.id), await getImportRun(testDb, runB.id)];
    expect(rows.filter((r) => r?.status === "done").length).toBe(1);
    expect(rows.filter((r) => r?.status === "error").length).toBe(1);
    // Idempotent import means the loser adds nothing even if it had run.
    expect(await testDb.lesson.count()).toBe(1);
  });

  it("isImportLockHeld reflects the actual advisory lock, not wall-clock", async () => {
    const probe = singleConnectionClient();
    try {
      expect(await isImportLockHeld(probe)).toBe(false); // nothing held

      const holder = singleConnectionClient();
      try {
        await withAdvisoryLock(holder, IMPORT_LOCK_NAME, async () => {
          // A distinct session sees the lock as held while the holder keeps it.
          const inner = singleConnectionClient();
          try {
            expect(await isImportLockHeld(inner)).toBe(true);
          } finally {
            await inner.$disconnect();
          }
        });
      } finally {
        await holder.$disconnect();
      }

      expect(await isImportLockHeld(probe)).toBe(false); // released again
    } finally {
      await probe.$disconnect();
    }
  });

  it("markStaleActiveRunsFailed reconciles crashed runs, spares fresh and terminal ones", async () => {
    const admin = await createTestUser({ email: "imp-admin4@x.io", role: "admin" });
    const mk = async (name: string) =>
      createImportRun(testDb, { actorId: admin.id, fileName: name, fileSize: 10, dryRun: false });

    const fresh = await mk("fresh.md");
    await testDb.importRun.update({ where: { id: fresh.id }, data: { status: "committing" } });
    const stale = await mk("stale.md");
    await testDb.importRun.update({
      where: { id: stale.id },
      data: { status: "committing", startedAt: new Date(Date.now() - 20 * 60_000) },
    });
    const doneOld = await mk("done.md");
    await testDb.importRun.update({
      where: { id: doneOld.id },
      data: { status: "done", startedAt: new Date(Date.now() - 30 * 60_000) },
    });

    const count = await markStaleActiveRunsFailed(testDb);
    expect(count).toBe(1); // only the abandoned active run

    expect((await getImportRun(testDb, fresh.id))?.status).toBe("committing"); // young → left
    expect((await getImportRun(testDb, stale.id))?.status).toBe("error"); // crashed → reconciled
    expect((await getImportRun(testDb, doneOld.id))?.status).toBe("done"); // terminal → left
  });
});

// --- ZIP reader hardening (spec 7.14: битые/злонамеренные архивы) ---

/** Builds a minimal ZIP (store or deflate) for the reader tests. */
function buildZip(
  entries: { name: string; raw: Buffer; method?: 0 | 8; declaredUncompressed?: number }[],
): Buffer {
  const localChunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const method = e.method ?? 0;
    const nameBuf = Buffer.from(e.name, "utf8");
    const stored = method === 8 ? zlib.deflateRawSync(e.raw) : e.raw;
    const uncompressed = e.declaredUncompressed ?? e.raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localOffset = offset;
    localChunks.push(local, nameBuf, stored);
    offset += 30 + nameBuf.length + stored.length;

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(0, 16); // crc
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(uncompressed, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(localOffset, 42);
    central.push(cd, nameBuf);
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, cdBuf, eocd]);
}

describe("extractImagesFromZip — hardening (spec 7.14)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mentors-ziptest-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("no zip-slip: a traversal name is written under its basename inside destDir", () => {
    const zip = buildZip([{ name: "../../../evil.png", raw: Buffer.from("img") }]);
    const out = extractImagesFromZip(zip, dir);
    expect(out.extracted).toBe(1);
    expect(fs.readdirSync(dir)).toEqual(["evil.png"]); // basename only, nothing escaped
  });

  it("extracts images, skips non-image entries", () => {
    const zip = buildZip([
      { name: "notes.txt", raw: Buffer.from("hi") },
      { name: "pics/ok.png", raw: Buffer.from("img") },
    ]);
    const out = extractImagesFromZip(zip, dir);
    expect(out.extracted).toBe(1);
    expect(fs.existsSync(path.join(dir, "ok.png"))).toBe(true);
  });

  it("total-size cap: exceeding the uncompressed budget throws a human error", () => {
    const zip = buildZip([
      { name: "a.png", raw: Buffer.alloc(10, 1) },
      { name: "b.png", raw: Buffer.alloc(10, 1) },
    ]);
    expect(() => extractImagesFromZip(zip, dir, { maxTotalBytes: 15 })).toThrow(ImportZipError);
  });

  it("decompression bomb: a lying uncompressed size is caught by maxOutputLength", () => {
    // Deflate 5000 bytes but declare only 10 → passes the declared check, then the
    // actual inflation blows past maxEntryBytes → RangeError → entry skipped.
    const zip = buildZip([
      { name: "bomb.png", raw: Buffer.alloc(5000, 7), method: 8, declaredUncompressed: 10 },
    ]);
    const out = extractImagesFromZip(zip, dir, { maxEntryBytes: 100 });
    expect(out.extracted).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("a corrupt (non-zip) buffer yields zero images, never throws", () => {
    const out = extractImagesFromZip(Buffer.from("definitely not a zip file"), dir);
    expect(out.extracted).toBe(0);
  });
});
