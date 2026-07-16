"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
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
  requireActionRole,
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
    const auth = await requireActionRole("mentor");
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
    const auth = await requireActionRole("mentor");
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
