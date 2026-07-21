"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { createAnnouncement, markAnnouncementRead } from "@/lib/services/announcements";
import { zonedDateTimeToUtc } from "@/lib/utils/dates";
import {
  assertNotImpersonating,
  parseInput,
  requireActionPermission,
  requireActionStudent,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { createAnnouncementSchema, dismissBannerSchema } from "@/lib/utils/validation";

// Announcements mutations (spec 8.5). Create — admin+ (spec 2). Banner dismissal
// — the student marking it read (announcement_reads).

/**
 * «2026-07-20T09:00» (datetime-local, admin wall-clock) → UTC instant in the
 * admin's timezone (spec 0.6: storage is UTC, input is local). Empty/invalid →
 * fallback. Without the zoned conversion a Moscow admin's «09:00» would be read
 * as 09:00 UTC on the UTC prod container — off by their offset.
 */
function parseDateTime(
  value: string | undefined,
  fallback: Date | null,
  timeZone: string,
): Date | null {
  if (!value) return fallback;
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return fallback;
  const hhmm = timePart.slice(0, 5); // drop seconds if the picker included them
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) {
    return fallback;
  }
  return zonedDateTimeToUtc(datePart, hhmm, timeZone);
}

export async function createAnnouncementAction(
  input: unknown,
): Promise<ActionResult<{ id: string; delivered: number }>> {
  return runAction(async () => {
    const auth = await requireActionPermission("announcements.manage");
    const parsed = parseInput(createAnnouncementSchema, input);
    const now = new Date();
    const tz = auth.user.timezone;
    const result = await createAnnouncement(prisma, {
      actorId: auth.user.id,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      kind: parsed.kind,
      segment: parsed.segment,
      startsAt: parseDateTime(parsed.startsAt, now, tz) ?? now,
      endsAt: parseDateTime(parsed.endsAt, null, tz),
    });
    revalidatePath("/admin/announcements");
    return result;
  });
}

export async function dismissBannerAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionStudent();
    assertNotImpersonating(auth);
    const parsed = parseInput(dismissBannerSchema, input);
    await markAnnouncementRead(prisma, auth.user.id, parsed.announcementId);
    return undefined;
  });
}
