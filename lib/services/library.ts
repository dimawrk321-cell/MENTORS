import type {
  CompanyType,
  ContentStatus,
  Prisma,
  PrismaClient,
  RecordingDirection,
  RecordingGrade,
  RecordingOutcome,
  RecordingStage,
} from "@prisma/client";
import type { Db } from "@/lib/db";
import { emitEvent } from "@/lib/services/events";
import { writeAudit } from "@/lib/services/audit";
import { isChecklistComplete } from "@/lib/constants";

// Library service (spec 7.9): catalog + view-logging for students, CRUD with a
// checklist publication gate for admin. Company names are never stored on the
// student-facing surface — the card label is computed from stage/direction/grade.

export interface RecordingChecklist {
  faces: boolean;
  voice: boolean;
  names: boolean;
  consent: boolean;
}

export interface RecordingData {
  title: string;
  stage: RecordingStage;
  direction: RecordingDirection;
  grade: RecordingGrade;
  outcome: RecordingOutcome;
  companyType: CompanyType;
  durationMinutes: number;
  url: string;
  embedUrl: string | null;
  checklist: RecordingChecklist;
  status: ContentStatus;
}

export interface RecordingFilters {
  stage?: RecordingStage;
  direction?: RecordingDirection;
  grade?: RecordingGrade;
  outcome?: RecordingOutcome;
  companyType?: CompanyType;
}

function whereFromFilters(f: RecordingFilters): Prisma.RecordingWhereInput {
  return {
    ...(f.stage ? { stage: f.stage } : {}),
    ...(f.direction ? { direction: f.direction } : {}),
    ...(f.grade ? { grade: f.grade } : {}),
    ...(f.outcome ? { outcome: f.outcome } : {}),
    ...(f.companyType ? { companyType: f.companyType } : {}),
  };
}

// --- Student catalog & view (spec 7.9) ---

/** Published recordings for the /library catalog, filtered per spec 7.9. */
export async function listRecordingsCatalog(db: Db, filters: RecordingFilters) {
  return db.recording.findMany({
    where: { status: "published", ...whereFromFilters(filters) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stage: true,
      direction: true,
      grade: true,
      outcome: true,
      companyType: true,
      durationMinutes: true,
    },
  });
}

export async function getRecordingForView(db: Db, id: string) {
  return db.recording.findFirst({
    where: { id, status: "published" },
    select: {
      id: true,
      stage: true,
      direction: true,
      grade: true,
      outcome: true,
      companyType: true,
      durationMinutes: true,
      url: true,
      embedUrl: true,
    },
  });
}

export type OpenRecordingResult =
  { ok: true; url: string; embedUrl: string | null } | { ok: false; code: "not_found" };

/**
 * Logs an open (spec 7.9: ЛЮБОЕ открытие → recording_views + recording.opened).
 * No dedup — every open is a distinct row so the access trail is complete.
 */
export async function logRecordingOpen(
  db: PrismaClient,
  input: { userId: string; recordingId: string; now?: Date },
): Promise<OpenRecordingResult> {
  const recording = await db.recording.findFirst({
    where: { id: input.recordingId, status: "published" },
    select: { id: true, url: true, embedUrl: true },
  });
  if (!recording) return { ok: false, code: "not_found" };

  await db.$transaction(async (tx) => {
    await tx.recordingView.create({
      data: { recordingId: recording.id, userId: input.userId },
    });
    await emitEvent(
      tx,
      "recording.opened",
      { recordingId: recording.id },
      {
        userId: input.userId,
        now: input.now,
      },
    );
  });
  return { ok: true, url: recording.url, embedUrl: recording.embedUrl };
}

// --- Admin (spec 7.9 / 8.5) ---

export interface AdminRecordingFilters extends RecordingFilters {
  status?: ContentStatus;
}

export async function listRecordingsAdmin(db: Db, filters: AdminRecordingFilters) {
  return db.recording.findMany({
    where: {
      ...whereFromFilters(filters),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { views: true } } },
  });
}

export async function getRecordingAdmin(db: Db, id: string) {
  return db.recording.findUnique({ where: { id } });
}

export type UpsertRecordingResult =
  { ok: true; id: string } | { ok: false; code: "not_found" | "checklist_incomplete" };

/**
 * Create or update a recording (spec 7.9). Publication is gated on a complete
 * checklist here too (not only in the UI): a request to publish an incomplete
 * recording is refused. Rotating the Я.Диск url bumps link_updated_at so the
 * freshness monitor (Пульт, spec 7.9) sees the reset.
 */
export async function upsertRecording(
  db: PrismaClient,
  input: { actorId: string; id?: string | null; data: RecordingData; now?: Date },
): Promise<UpsertRecordingResult> {
  const now = input.now ?? new Date();
  const { data } = input;

  if (data.status === "published" && !isChecklistComplete(data.checklist)) {
    return { ok: false, code: "checklist_incomplete" };
  }

  const checklist = data.checklist as unknown as Prisma.InputJsonValue;

  if (input.id) {
    const before = await db.recording.findUnique({ where: { id: input.id } });
    if (!before) return { ok: false, code: "not_found" };
    const linkRotated = before.url !== data.url;

    await db.$transaction(async (tx) => {
      const updated = await tx.recording.update({
        where: { id: input.id! },
        data: {
          title: data.title,
          stage: data.stage,
          direction: data.direction,
          grade: data.grade,
          outcome: data.outcome,
          companyType: data.companyType,
          durationMinutes: data.durationMinutes,
          url: data.url,
          embedUrl: data.embedUrl,
          checklist,
          status: data.status,
          ...(linkRotated ? { linkUpdatedAt: now } : {}),
        },
      });
      await writeAudit(tx, {
        actorId: input.actorId,
        action: "recording.updated",
        entityType: "recording",
        entityId: updated.id,
        before: {
          title: before.title,
          status: before.status,
          url: before.url,
          checklist: before.checklist as Prisma.InputJsonValue,
        },
        after: { title: data.title, status: data.status, url: data.url, checklist },
      });
    });
    return { ok: true, id: input.id };
  }

  const created = await db.$transaction(async (tx) => {
    const row = await tx.recording.create({
      data: {
        title: data.title,
        stage: data.stage,
        direction: data.direction,
        grade: data.grade,
        outcome: data.outcome,
        companyType: data.companyType,
        durationMinutes: data.durationMinutes,
        url: data.url,
        embedUrl: data.embedUrl,
        checklist,
        status: data.status,
        linkUpdatedAt: now,
      },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "recording.created",
      entityType: "recording",
      entityId: row.id,
      after: { title: data.title, status: data.status },
    });
    return row;
  });
  return { ok: true, id: created.id };
}

export type SetRecordingStatusResult =
  { ok: true } | { ok: false; code: "not_found" | "checklist_incomplete" };

/** Quick publish/unpublish from the admin table (still checklist-gated). */
export async function setRecordingStatus(
  db: PrismaClient,
  input: { actorId: string; id: string; status: ContentStatus },
): Promise<SetRecordingStatusResult> {
  const before = await db.recording.findUnique({ where: { id: input.id } });
  if (!before) return { ok: false, code: "not_found" };
  if (input.status === "published" && !isChecklistComplete(before.checklist)) {
    return { ok: false, code: "checklist_incomplete" };
  }
  await db.$transaction(async (tx) => {
    await tx.recording.update({ where: { id: input.id }, data: { status: input.status } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "recording.status_changed",
      entityType: "recording",
      entityId: input.id,
      before: { status: before.status },
      after: { status: input.status },
    });
  });
  return { ok: true };
}

export type DeleteRecordingResult =
  { ok: true } | { ok: false; code: "not_found" | "not_draft" | "has_views" };

/**
 * Delete a recording — only a draft with zero views (spec 8.5 changelog:
 * symmetric to draft-only content deletion). A viewed recording carries
 * recording_views access history and is never deleted. Audited.
 */
export async function deleteRecording(
  db: PrismaClient,
  input: { actorId: string; id: string },
): Promise<DeleteRecordingResult> {
  const recording = await db.recording.findUnique({
    where: { id: input.id },
    select: { id: true, title: true, status: true, _count: { select: { views: true } } },
  });
  if (!recording) return { ok: false, code: "not_found" };
  if (recording.status !== "draft") return { ok: false, code: "not_draft" };
  if (recording._count.views > 0) return { ok: false, code: "has_views" };

  await db.$transaction(async (tx) => {
    await tx.recording.delete({ where: { id: input.id } });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: "recording.deleted",
      entityType: "recording",
      entityId: input.id,
      before: { title: recording.title, status: recording.status },
    });
  });
  return { ok: true };
}

// --- Per-student section access toggles (spec 7.9/7.10/8.5, 12.1/C3) ---

export type ToggleLibraryResult = { ok: true } | { ok: false; code: "not_found" };

/** The three per-student section toggles (spec 12.1/C3). */
export type SectionFlag = "library" | "resume" | "legend";

const SECTION_FIELD: Record<
  SectionFlag,
  "libraryEnabled" | "guidesResumeEnabled" | "guidesLegendEnabled"
> = {
  library: "libraryEnabled",
  resume: "guidesResumeEnabled",
  legend: "guidesLegendEnabled",
};

const SECTION_AUDIT: Record<SectionFlag, string> = {
  library: "user.library_toggled",
  resume: "user.guides_resume_toggled",
  legend: "user.guides_legend_toggled",
};

/**
 * Toggle one per-student section flag (Библиотека / Резюме / Легенда). Students
 * only; writes the flag + an audit entry in one transaction (spec 8.5).
 */
export async function setSectionAccess(
  db: PrismaClient,
  input: { actorId: string; userId: string; section: SectionFlag; enabled: boolean },
): Promise<ToggleLibraryResult> {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user || user.role !== "student") return { ok: false, code: "not_found" };

  const field = SECTION_FIELD[input.section];
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { [field]: input.enabled },
    });
    await writeAudit(tx, {
      actorId: input.actorId,
      action: SECTION_AUDIT[input.section],
      entityType: "user",
      entityId: input.userId,
      before: { [field]: user[field] },
      after: { [field]: input.enabled },
    });
  });
  return { ok: true };
}

/** Backward-compatible library-only wrapper (spec 7.9). */
export async function setLibraryEnabled(
  db: PrismaClient,
  input: { actorId: string; userId: string; enabled: boolean },
): Promise<ToggleLibraryResult> {
  return setSectionAccess(db, { ...input, section: "library" });
}
