import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { getStreakState } from "@/lib/services/streak";
import { notify, resolveEffectivePref } from "@/lib/services/notifications";
import { localHour, localDateStr, zonedDayUtcRange } from "@/lib/utils/dates";

// streak_risk job (spec 7.12/7.15): around 20:00 in the user's TZ, if the day is
// not yet counted and the streak is ≥3, nudge — but only for students who opted
// in (streak_risk is default off). Runs every 30 min UTC; the evening-window +
// once-per-day guards make it fire once around 20:00 local.

export async function runStreakRiskJob(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const students = await db.user.findMany({
    where: { role: "student", status: "active" },
    select: { id: true, timezone: true, studyDays: true },
  });

  let sent = 0;
  for (const student of students) {
    try {
      // Opt-in only (default off — spec 7.12).
      const pref = await resolveEffectivePref(db, student.id, "streak_risk");
      if (!pref.inapp) continue;

      const hour = localHour(now, student.timezone);
      if (hour < 20 || hour >= 22) continue; // evening window around 20:00

      const state = await getStreakState(db, {
        userId: student.id,
        now,
        timezone: student.timezone,
        studyDays: student.studyDays,
      });
      if (!state.atRisk) continue; // не в учебный день / уже засчитан / серия <3 / paused

      // Once per local day.
      const dayStart = zonedDayUtcRange(
        localDateStr(now, student.timezone),
        student.timezone,
      ).start;
      const already = await db.notification.count({
        where: { userId: student.id, type: "streak_risk", createdAt: { gte: dayStart } },
      });
      if (already > 0) continue;

      await notify(db, student.id, "streak_risk", { current: state.current }, { now });
      sent += 1;
    } catch (err) {
      logger.warn({ err, userId: student.id }, "streak_risk: skipping user after error");
    }
  }
  return sent;
}
