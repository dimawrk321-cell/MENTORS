"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  bulkSetRecordingStatus,
  deleteRecording,
  getRecordingForView,
  logRecordingOpen,
  setRecordingStatus,
  upsertRecording,
  type RecordingData,
} from "@/lib/services/library";
import {
  ActionError,
  assertActiveAccess,
  parseInput,
  requireActionPermission,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { recordingIdSchema, recordingUpsertSchema } from "@/lib/utils/validation";
import { touchRecentItem } from "@/lib/services/recent";

// Library actions (spec 7.9). Students log opens; mentor+ manage recordings.

// --- Student ---

export type OpenRecordingData = { url: string; embedUrl: string | null };

/**
 * Logs a recording open (spec 7.9: любое открытие → recording_views +
 * recording.opened). Under impersonation the view is read-only (spec 7.2), so
 * the recording is returned without writing the student's access trail.
 */
export async function openRecordingAction(
  recordingId: string,
): Promise<ActionResult<OpenRecordingData>> {
  return runAction(async () => {
    const auth = await requireActionStudent();
    assertActiveAccess(auth);
    if (!auth.user.libraryEnabled) {
      throw new ActionError("forbidden", "Раздел библиотеки недоступен");
    }
    const { recordingId: id } = parseInput(recordingIdSchema, { recordingId });

    if (auth.impersonated) {
      const recording = await getRecordingForView(prisma, id);
      if (!recording) throw new ActionError("not_found", "Запись не найдена");
      return { url: recording.url, embedUrl: recording.embedUrl };
    }

    const res = await logRecordingOpen(prisma, { userId: auth.user.id, recordingId: id });
    if (!res.ok) throw new ActionError("not_found", "Запись не найдена");
    // Recency index for the palette (spec 7.11).
    await touchRecentItem(prisma, { userId: auth.user.id, itemType: "recording", entityId: id });
    return { url: res.url, embedUrl: res.embedUrl };
  });
}

// --- Admin (mentor+ — spec 2: управлять библиотекой записей) ---

function revalidateLibrary(recordingId?: string): void {
  revalidatePath("/admin/library");
  revalidatePath("/library");
  if (recordingId) revalidatePath(`/library/${recordingId}`);
}

export async function upsertRecordingAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(recordingUpsertSchema, input);
    const data: RecordingData = {
      title: parsed.title,
      stage: parsed.stage,
      direction: parsed.direction,
      grade: parsed.grade,
      outcome: parsed.outcome,
      companyType: parsed.companyType,
      durationMinutes: parsed.durationMinutes,
      url: parsed.url,
      embedUrl: parsed.embedUrl,
      checklist: parsed.checklist,
      status: parsed.status,
    };
    const res = await upsertRecording(prisma, {
      actorId: auth.user.id,
      id: parsed.id ?? null,
      data,
    });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "checklist_incomplete"
          ? "Опубликовать можно только когда отмечены все четыре пункта чеклиста"
          : "Запись не найдена",
      );
    }
    revalidateLibrary(res.id);
    return { id: res.id };
  });
}

export async function setRecordingStatusAction(
  id: string,
  status: "draft" | "published",
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await setRecordingStatus(prisma, { actorId: auth.user.id, id, status });
    if (!res.ok) {
      throw new ActionError(
        res.code,
        res.code === "checklist_incomplete"
          ? "Опубликовать можно только когда отмечены все четыре пункта чеклиста"
          : "Запись не найдена",
      );
    }
    revalidateLibrary(id);
    return undefined;
  });
}

const bulkRecordingSchema = z.object({
  recordingIds: z.array(z.string().min(1)).min(1, "Выбери записи").max(500),
  status: z.enum(["draft", "published"]),
});

/** Bulk publish (only 4/4-passing) / draft library records (spec 13.1/C3). */
export async function bulkRecordingStatusAction(
  input: unknown,
): Promise<ActionResult<{ message: string }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("content.manage");
    const parsed = parseInput(bulkRecordingSchema, input);
    const res = await bulkSetRecordingStatus(prisma, {
      actorId: auth.user.id,
      recordingIds: parsed.recordingIds,
      status: parsed.status,
    });
    revalidatePath("/admin/library");
    revalidatePath("/library");
    const verb = parsed.status === "published" ? "Опубликовано" : "В черновик";
    const skipNote =
      parsed.status === "published" && res.skipped > 0
        ? ` · ${res.skipped} пропущено (нет 4/4 или уже опубликованы)`
        : "";
    return { message: `${verb}: ${res.updated}${skipNote}` };
  });
}

/** Delete a draft recording with zero views (spec 8.5 changelog). mentor+. */
export async function deleteRecordingAction(id: string): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionPermission("content.manage");
    const res = await deleteRecording(prisma, { actorId: auth.user.id, id });
    if (!res.ok) {
      const message =
        res.code === "not_draft"
          ? "Удалять можно только черновики — сначала сними с публикации"
          : res.code === "has_views"
            ? "Запись уже просматривали — её нельзя удалить"
            : "Запись не найдена";
      throw new ActionError(res.code, message);
    }
    revalidatePath("/admin/library");
    return undefined;
  });
}
