import type { PrismaClient } from "@prisma/client";
import { expireOverdueAccess, sendAccessExpiryReminders } from "@/lib/services/access";
import { signalOwner } from "@/lib/services/telegram/owner-signals";

// expiryNotify + expire job (spec 7.15): 09:00 daily. Sends the 14/3/0-day
// access reminders (once each, via notify → email+in-app) and flips overdue
// students to expired (cancelling their future bookings). Reminders run first so
// a student expiring today still gets the 0-day notice before the flip.

export async function runExpiryNotifyJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ reminders: number; expired: number }> {
  const reminders = await sendAccessExpiryReminders(db, now);
  const expired = await expireOverdueAccess(db, now);
  // Owner signal (walk 13.3 block 4): daily rollup «доступ истёк у N» when N > 0.
  if (expired > 0) {
    await signalOwner(db, { kind: "access_expired", count: expired }, { now }).catch(() => {});
  }
  return { reminders, expired };
}
