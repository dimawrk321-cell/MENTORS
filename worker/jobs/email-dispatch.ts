import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/services/mail";
import { notificationEmail } from "@/emails/templates";

// emailDispatch job (spec 7.12: «отдельная выборка воркером»). Flushes the
// notification email outbox: rows with email_pending=true whose scheduled_at is
// due (now, or the end of the recipient's quiet hours). Sending happens here, off
// the request/transaction path — notify() only queues. A send failure leaves the
// row pending for the next run (at-least-once). jsonTransport (no SMTP) never
// throws, so dev mode just logs each message.

const BATCH_SIZE = 100;

export async function runEmailDispatchJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ sent: number; failed: number }> {
  const pending = await db.notification.findMany({
    where: { emailPending: true, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      url: true,
      user: { select: { email: true } },
    },
  });

  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    try {
      await sendEmail(
        n.user.email,
        notificationEmail({ type: n.type, title: n.title, body: n.body, url: n.url }),
      );
      await db.notification.update({
        where: { id: n.id },
        data: { emailPending: false, emailSentAt: now },
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      // Leave email_pending=true → retried next run.
      logger.error({ err, notificationId: n.id }, "email dispatch failed — will retry");
    }
  }
  return { sent, failed };
}
