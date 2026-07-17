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
//
// §9 acceptance fix: a pending email past its emailDeadline (for mock_* — the
// booking start) is skipped, not sent — a reminder must never arrive after the
// mock. The row is cleared (email_pending=false) so it doesn't linger in the outbox.

const BATCH_SIZE = 100;

export async function runEmailDispatchJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ sent: number; failed: number; skipped: number }> {
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
      emailDeadline: true,
      user: { select: { email: true } },
    },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const n of pending) {
    // Relevance deadline passed → drop without sending (clear the outbox flag).
    if (n.emailDeadline && n.emailDeadline < now) {
      await db.notification.update({ where: { id: n.id }, data: { emailPending: false } });
      skipped += 1;
      logger.info({ notificationId: n.id, type: n.type }, "email skipped — past deadline");
      continue;
    }
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
  return { sent, failed, skipped };
}
