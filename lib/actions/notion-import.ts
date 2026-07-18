"use server";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  ActionError,
  assertNotImpersonating,
  requireActionRole,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  cleanupImportTempDir,
  createImportRun,
  hasActiveImportRun,
  runImportJob,
  validateImportFile,
  validateImportZip,
  writeImportInputs,
} from "@/lib/services/notion-import/admin-import";

// /admin/import mutation (spec 7.14 / 8.5). admin+. Validates the upload, writes
// it to a temp dir outside git, records an import_runs row, and launches the
// import as a detached in-process job (same service code as the CLI). Returns the
// run id so the page can poll status. Impersonation is read-only (spec 7.2).

interface UploadedFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value
  );
}

export async function startImportAction(
  formData: FormData,
): Promise<ActionResult<{ runId: string }>> {
  return runAction<{ runId: string }>(async () => {
    const auth = await requireActionRole("admin");
    assertNotImpersonating(auth);

    const file = formData.get("file");
    if (!isUploadedFile(file)) {
      throw new ActionError("validation", "Прикрепи файл экспорта (.md)");
    }
    // Default to the safe mode: only «--commit» (dryRun=0) writes to the DB.
    const dryRun = formData.get("dryRun") !== "0";

    const buffer = Buffer.from(await file.arrayBuffer());
    const mdCheck = validateImportFile({ name: file.name, size: buffer.length, buffer });
    if (!mdCheck.ok) throw new ActionError("validation", mdCheck.message!);

    const zipEntry = formData.get("zip");
    let zipBuffer: Buffer | null = null;
    if (isUploadedFile(zipEntry) && zipEntry.size > 0) {
      const zipCheck = validateImportZip({ name: zipEntry.name, size: zipEntry.size });
      if (!zipCheck.ok) throw new ActionError("validation", zipCheck.message!);
      zipBuffer = Buffer.from(await zipEntry.arrayBuffer());
    }

    // UX guard + dead-run recovery; the advisory lock in the job is the hard one.
    if (await hasActiveImportRun(prisma)) {
      throw new ActionError("conflict", "Импорт уже выполняется — дождись завершения");
    }

    const run = await createImportRun(prisma, {
      actorId: auth.user.id,
      fileName: file.name,
      fileSize: buffer.length,
      dryRun,
    });

    try {
      writeImportInputs(run.id, { markdown: buffer, zip: zipBuffer });
    } catch (err) {
      logger.error({ err, runId: run.id }, "import input staging failed");
      cleanupImportTempDir(run.id);
      await prisma.importRun.update({
        where: { id: run.id },
        data: {
          status: "error",
          error: "Не удалось подготовить файл к импорту",
          finishedAt: new Date(),
        },
      });
      throw new ActionError("internal", "Не удалось подготовить файл к импорту");
    }

    // Detached, in-process (spec 7.14 DECISION): continues after this action
    // returns; the page polls the run row. The job makes + owns a fresh advisory-
    // lock session (re-entrancy-safe). runImportJob never throws out.
    void runImportJob(
      { db: prisma },
      {
        runId: run.id,
        dryRun,
        fileLabel: file.name,
        actorId: auth.user.id,
      },
    ).catch((err) => logger.error({ err, runId: run.id }, "detached import job crashed"));

    return { runId: run.id };
  });
}
