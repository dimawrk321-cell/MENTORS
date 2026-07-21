import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAuth } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import {
  MAX_UPLOAD_BYTES,
  cleanupImportTempDir,
  createImportRun,
  isImportLockHeld,
  markStaleActiveRunsFailed,
  runImportJob,
  validateImportFile,
  validateImportZip,
  writeImportInputs,
} from "@/lib/services/notion-import/admin-import";
import { ImportZipError } from "@/lib/services/notion-import/zip";

// Import upload + start (spec 7.14 / 8.5). admin+, non-impersonating. DECISION:
// a Route Handler, NOT a Server Action — the export upload is large (md ≤25 MB +
// zip ≤100 MB) and raising serverActions.bodySizeLimit is GLOBAL (would let every
// action accept 100+ MB — a DoS amplifier). Here RBAC and the Content-Length cap
// are checked BEFORE the body is buffered, so the large body is confined to this
// one admin-only endpoint and the default 1 MB action limit stays untouched.

export const dynamic = "force-dynamic";

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

export async function POST(req: Request) {
  const auth = await getAuth();
  // RBAC first — an unauthorized caller never causes the body to be buffered.
  // Import is part of content management (spec 12.4/B1: content.manage).
  if (auth.state !== "valid" || !hasPermission(auth.user, "content.manage")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  if (auth.session.impersonatorId) {
    return NextResponse.json({ error: "Режим просмотра — изменения недоступны" }, { status: 403 });
  }
  // Reject an oversized upload before reading the body (Content-Length guard).
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Файл слишком большой" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Не удалось прочитать загрузку" }, { status: 400 });
  }

  const file = form.get("file");
  if (!isUploadedFile(file)) {
    return NextResponse.json({ error: "Прикрепи файл экспорта (.md)" }, { status: 400 });
  }
  // Default to the safe mode: only «--commit» (dryRun=0) writes to the DB.
  const dryRun = form.get("dryRun") !== "0";

  const buffer = Buffer.from(await file.arrayBuffer());
  const mdCheck = validateImportFile({ name: file.name, size: buffer.length, buffer });
  if (!mdCheck.ok) {
    return NextResponse.json({ error: mdCheck.message }, { status: 400 });
  }

  const zipEntry = form.get("zip");
  let zipBuffer: Buffer | null = null;
  if (isUploadedFile(zipEntry) && zipEntry.size > 0) {
    const zipCheck = validateImportZip({ name: zipEntry.name, size: zipEntry.size });
    if (!zipCheck.ok) {
      return NextResponse.json({ error: zipCheck.message }, { status: 400 });
    }
    zipBuffer = Buffer.from(await zipEntry.arrayBuffer());
  }

  // Authoritative guard: an import is running iff the advisory lock is held (a
  // slow-but-alive job blocks honestly; a crashed one — lock already released —
  // does not). The job's own withAdvisoryLock is still the hard serializer.
  // Residual (low): two exactly-simultaneous starts can both pass this probe
  // before either job takes the lock — the lock still admits only one; the loser's
  // row is marked error. No double import, just a spurious history row.
  if (await isImportLockHeld()) {
    return NextResponse.json(
      { error: "Импорт уже выполняется — дождись завершения" },
      { status: 409 },
    );
  }
  // Lock is free → nothing is live; reconcile any run a crash left non-terminal.
  await markStaleActiveRunsFailed(prisma);

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
    const message =
      err instanceof ImportZipError ? err.message : "Не удалось подготовить файл к импорту";
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Detached, in-process (spec 7.14 DECISION): continues after this response; the
  // page polls the run row. The job makes + owns a fresh advisory-lock session
  // (re-entrancy-safe). runImportJob never throws out.
  void runImportJob(
    { db: prisma },
    { runId: run.id, dryRun, fileLabel: file.name, actorId: auth.user.id },
  ).catch((err) => logger.error({ err, runId: run.id }, "detached import job crashed"));

  return NextResponse.json({ runId: run.id });
}
