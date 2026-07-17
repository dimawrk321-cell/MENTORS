import type { PrismaClient } from "@prisma/client";
import { expireOverdueAccess, sendAccessExpiryReminders } from "@/lib/services/access";

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
  return { reminders, expired };
}
