import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getSrsQueue } from "@/lib/services/srs";
import { notify } from "@/lib/services/notifications";
import {
  hhmmToMinutes,
  localDateStr,
  localMinutesOfDay,
  zonedDayUtcRange,
} from "@/lib/utils/dates";

// digest job (spec 7.15): every 15 min. For each active student whose digest_time
// falls in the current 15-min window (their TZ) and who has a non-empty review
// queue, send «Сегодня к повторению: N карточек (~M мин)» once per day. Empty
// queue is silent (spec 7.12 «лучше недослать»).

const WINDOW_MINUTES = 15;

export async function runDigestJob(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const students = await db.user.findMany({
    where: { role: "student", status: "active" },
    select: { id: true, timezone: true, digestTime: true },
  });

  let sent = 0;
  for (const student of students) {
    // Per-student isolation: one bad user must not drop the rest of the batch.
    try {
      // Fire on the first 15-min tick at/after digest_time (local, mod day).
      const nowMin = localMinutesOfDay(now, student.timezone);
      const digestMin = hhmmToMinutes(student.digestTime);
      const delta = (((nowMin - digestMin) % 1440) + 1440) % 1440;
      if (delta >= WINDOW_MINUTES) continue;

      // Once per local day (idempotent across re-runs within the window).
      const dayStart = zonedDayUtcRange(
        localDateStr(now, student.timezone),
        student.timezone,
      ).start;
      const already = await db.notification.count({
        where: { userId: student.id, type: "digest", createdAt: { gte: dayStart } },
      });
      if (already > 0) continue;

      const queue = await getSrsQueue(db, { userId: student.id, now });
      if (queue.total === 0) continue; // пустая очередь молчит

      await notify(
        db,
        student.id,
        "digest",
        { count: queue.total, estimateMin: queue.estimateMinutes },
        { now },
      );
      sent += 1;
    } catch (err) {
      logger.warn({ err, userId: student.id }, "digest: skipping user after error");
    }
  }
  return sent;
}
