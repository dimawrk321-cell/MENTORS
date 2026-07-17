import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { notify } from "@/lib/services/notifications";
import { formatDateTimeRu } from "@/lib/utils/dates";

// mockReminders job: mock_24h / mock_1h reminders (spec 7.8 «за 24 ч и за 1 ч»,
// types in table 7.12; templates listed in the stage-9 task). DECISION: 7.15
// doesn't list a reminder job, but 7.8/7.12 require the reminders — this is the
// simplest doc-consistent delivery. Runs every 15 min; idempotent per booking
// per type (dedup on the notification's type+url). Once a reminder window is
// entered the notice fires once; a last-minute booking may get both at once.

const HOUR_MS = 60 * 60 * 1000;

export async function runMockRemindersJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ sent24: number; sent1: number }> {
  const in24h = new Date(now.getTime() + 24 * HOUR_MS);
  const in1h = new Date(now.getTime() + HOUR_MS);

  const bookings = await db.booking.findMany({
    where: { status: "booked", slot: { startsAt: { gt: now, lte: in24h } } },
    select: {
      id: true,
      userId: true,
      user: { select: { timezone: true } },
      slot: { select: { startsAt: true } },
    },
  });

  let sent24 = 0;
  let sent1 = 0;
  for (const booking of bookings) {
    try {
      const start = booking.slot.startsAt;
      const whenText = formatDateTimeRu(start, booking.user.timezone);
      const url = `/mocks/${booking.id}`;

      // 24h reminder — booking already inside the 24h window (query guarantees it).
      const has24 = await db.notification.count({
        where: { userId: booking.userId, type: "mock_24h", url },
      });
      if (has24 === 0) {
        await notify(db, booking.userId, "mock_24h", { bookingId: booking.id, whenText }, { now });
        sent24 += 1;
      }

      // 1h reminder — only once the start is within the next hour.
      if (start <= in1h) {
        const has1 = await db.notification.count({
          where: { userId: booking.userId, type: "mock_1h", url },
        });
        if (has1 === 0) {
          await notify(db, booking.userId, "mock_1h", { bookingId: booking.id, whenText }, { now });
          sent1 += 1;
        }
      }
    } catch (err) {
      logger.warn({ err, bookingId: booking.id }, "mockReminders: skipping booking after error");
    }
  }
  return { sent24, sent1 };
}
