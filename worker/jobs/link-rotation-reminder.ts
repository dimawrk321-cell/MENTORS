import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { LINK_STALE_DAYS } from "@/lib/constants";
import { notify } from "@/lib/services/notifications";
import { DAY_MS, localDateStr, zonedDayUtcRange } from "@/lib/utils/dates";

// linkRotationReminder job (spec 7.15): 1st of the month. Recordings whose
// Я.Диск link is older than 30 days → in-app notice to admin+ (spec 7.9 rotation
// discipline; the Пульт «Записи со старыми ссылками» widget shows the same count).
// DECISION: delivered in-app (the bell surfaces it for interviewer-admins); no
// new email template — link_rotation is inapp-only, always on, not in the matrix.

export async function runLinkRotationReminderJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ count: number; notified: number }> {
  const cutoff = new Date(now.getTime() - LINK_STALE_DAYS * DAY_MS);
  const count = await db.recording.count({ where: { linkUpdatedAt: { lt: cutoff } } });
  if (count === 0) return { count: 0, notified: 0 };

  const admins = await db.user.findMany({
    where: { role: { in: ["admin", "owner"] }, status: { not: "blocked" } },
    select: { id: true, timezone: true },
  });

  let notified = 0;
  for (const admin of admins) {
    try {
      // Once per local day (guards a same-day re-run).
      const dayStart = zonedDayUtcRange(localDateStr(now, admin.timezone), admin.timezone).start;
      const already = await db.notification.count({
        where: { userId: admin.id, type: "link_rotation", createdAt: { gte: dayStart } },
      });
      if (already > 0) continue;
      await notify(db, admin.id, "link_rotation", { count }, { now });
      notified += 1;
    } catch (err) {
      logger.warn({ err, userId: admin.id }, "linkRotationReminder: skipping admin after error");
    }
  }
  return { count, notified };
}
