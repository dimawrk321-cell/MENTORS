import type { Db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Notifications seam (spec 7.12). Stage 5 needs a single call site for the
// notifications the gamification core produces (freeze_used, streak_risk), but
// the `notifications`/`notification_prefs` tables, the bell and email delivery
// all arrive at stage 9. Until then this is a deliberate stub: it records intent
// in the logs and is the ONE place stage 9 will wire real delivery.
//
// TODO(stage 9): persist to `notifications`, respect `notification_prefs` +
// quiet hours (spec 7.12), and deliver in-app (bell) + email.

export interface NotificationInput {
  userId: string;
  /** Тип из таблицы 7.12 (freeze_used, streak_risk, ...). */
  type: string;
  title?: string;
  body?: string;
  url?: string;
}

/** Enqueue an in-app/email notification (stubbed until stage 9). */
export async function enqueueNotification(_db: Db, input: NotificationInput): Promise<void> {
  // Intentionally a no-op write for now — logged so the intent is observable.
  logger.debug({ notification: input }, "notification enqueued (stub)");
}
