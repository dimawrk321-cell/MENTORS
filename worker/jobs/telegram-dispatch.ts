import type { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isTelegramFuseExempt } from "@/lib/services/notifications";
import { getRenewalContact } from "@/lib/services/settings";
import { unlinkTelegram } from "@/lib/services/telegram/linking";
import { sendTelegramMessage, TelegramApiError } from "@/lib/services/telegram/api";
import {
  notificationMessage,
  type NotificationButtonContext,
  type TelegramMessageSpec,
} from "@/lib/services/telegram/format";

// telegramDispatch (walk 13.3 block 2.3): flushes the Telegram outbox — the mirror
// of emailDispatch. Idempotent (telegram_sent_at), respects the shared deadline,
// applies the hourly hygiene fuse (block 5), and soft-auto-unlinks a blocked chat.

const BATCH_SIZE = 100;
/** Hourly unsolicited-message cap window (spec block 5). */
const FUSE_WINDOW_MS = 60 * 60 * 1000;

/** The send seam — injected in tests («API мокается»), real Bot API in prod. */
export type TelegramSend = (chatId: string, spec: TelegramMessageSpec) => Promise<void>;

export interface TelegramDispatchResult {
  sent: number;
  failed: number;
  skipped: number;
  unlinked: number;
  disabled?: boolean;
}

function bookingIdFromUrl(url: string | null): string | null {
  const m = url?.match(/^\/mocks\/([^/]+)$/);
  return m ? m[1]! : null;
}

export async function runTelegramDispatchJob(
  db: PrismaClient,
  now: Date = new Date(),
  sender?: TelegramSend,
): Promise<TelegramDispatchResult> {
  const token = env.telegramBotToken;
  // Channel off (no token) and no injected sender ⇒ silent no-op (spec block 1.1).
  if (!token && !sender) return { sent: 0, failed: 0, skipped: 0, unlinked: 0, disabled: true };
  const send: TelegramSend =
    sender ?? ((chatId, spec) => sendTelegramMessage(token!, chatId, spec.text, spec.buttons));

  const pending = await db.notification.findMany({
    where: { telegramPending: true, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      url: true,
      emailDeadline: true,
      userId: true,
      user: { select: { telegramLink: { select: { chatId: true } } } },
    },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let unlinked = 0;
  const unlinkedUsers = new Set<string>();

  const clearPending = (id: string) =>
    db.notification.update({ where: { id }, data: { telegramPending: false } });

  for (const n of pending) {
    // A blocked chat this batch already unlinked — drop the rest for that user.
    if (unlinkedUsers.has(n.userId)) {
      await clearPending(n.id);
      skipped += 1;
      continue;
    }
    // Relevance deadline (mock_* → booking start): a late message is useless.
    if (n.emailDeadline && n.emailDeadline < now) {
      await clearPending(n.id);
      skipped += 1;
      continue;
    }
    const chatId = n.user.telegramLink?.chatId;
    if (!chatId) {
      // Unlinked after enqueue (profile/stop/auto): «ноль сообщений неподключившимся».
      await clearPending(n.id);
      skipped += 1;
      continue;
    }
    // Hourly fuse (spec block 5): at most 1 unsolicited message/hour/user, except
    // mock_1h and always-on types. The in-app copy still notified immediately.
    if (!isTelegramFuseExempt(n.type)) {
      const recent = await db.notification.count({
        where: {
          userId: n.userId,
          telegramSentAt: { gt: new Date(now.getTime() - FUSE_WINDOW_MS) },
        },
      });
      if (recent >= 1) {
        await clearPending(n.id);
        skipped += 1;
        logger.info({ notificationId: n.id, type: n.type }, "telegram fused — hourly cap");
        continue;
      }
    }

    const ctx = await resolveButtonContext(db, n.type, n.url);
    const spec = notificationMessage(n, ctx);
    try {
      await send(chatId, spec);
      await db.notification.update({
        where: { id: n.id },
        data: { telegramPending: false, telegramSentAt: now },
      });
      sent += 1;
    } catch (err) {
      if (err instanceof TelegramApiError && err.isUnreachable) {
        // Bot blocked/deleted: soft auto-unlink + in-app «Telegram отключён» (block 2.3).
        await autoUnlink(db, n.userId, now);
        unlinkedUsers.add(n.userId);
        unlinked += 1;
      } else {
        // Transient: leave pending for the next tick (at-least-once).
        failed += 1;
        logger.error({ err, notificationId: n.id }, "telegram dispatch failed — will retry");
      }
    }
  }

  return { sent, failed, skipped, unlinked };
}

async function resolveButtonContext(
  db: PrismaClient,
  type: string,
  url: string | null,
): Promise<NotificationButtonContext> {
  if (type === "mock_24h" || type === "mock_1h") {
    const bookingId = bookingIdFromUrl(url);
    if (!bookingId) return {};
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { roomUrl: true },
    });
    return { roomUrl: booking?.roomUrl ?? null };
  }
  if (type === "access_14d" || type === "access_3d" || type === "access_0d") {
    return { renewalContact: await getRenewalContact(db) };
  }
  return {};
}

/**
 * Soft auto-unlink on a blocked chat (spec block 2.3): unlink, clear the user's
 * whole telegram outbox, and drop one in-app «Telegram отключён» so they know why.
 */
async function autoUnlink(db: PrismaClient, userId: string, now: Date): Promise<void> {
  await unlinkTelegram(db, userId, { reason: "bot_blocked" });
  await db.notification.updateMany({
    where: { userId, telegramPending: true },
    data: { telegramPending: false },
  });
  await db.notification.create({
    data: {
      userId,
      type: "telegram_unlinked",
      title: "Telegram отключён",
      body: "Бот заблокирован — уведомления в Telegram отключены. Снова подключить можно в профиле.",
      url: "/profile",
      inApp: true,
      createdAt: now,
    },
  });
}
