import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";

// DECISION: stage-1 event dispatcher only records analytics_events. XP, streak,
// achievements and notifications hooks are attached at stage 5 per the plan
// (section 17 — «events-диспетчер + рефакторинг эмитов»); every caller already
// goes through this single entry point, so the refactor stays local to this file.
//
// Stage-1 event types (spec 7.13): auth.login, session.evicted,
// access.extended, access.expired, security.flag.

export async function emitEvent(
  db: Db,
  type: string,
  payload: Prisma.InputJsonValue,
  opts: { userId?: string | null } = {},
): Promise<void> {
  await db.analyticsEvent.create({
    data: { type, payload, userId: opts.userId ?? null },
  });
}
