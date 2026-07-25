import type { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getTelegramLockClient } from "@/worker/lib/lock-client";
import { jobLockKey, tryAdvisoryLock, advisoryUnlock } from "@/worker/lib/advisory-lock";
import {
  getTelegramUpdates,
  sendTelegramMessage,
  answerCallbackQuery,
  deleteTelegramWebhook,
  type TelegramUpdate,
} from "@/lib/services/telegram/api";
import { handleTelegramUpdate, handleTelegramCallback } from "@/lib/services/telegram/commands";

// Telegram long-poll loop (walk 13.3 block 1.1). Runs for the worker's lifetime,
// started only when TELEGRAM_BOT_TOKEN is set (else the channel is silently off).
// A dedicated lifetime advisory lock guards against double-polling across worker
// replicas; the loop reconnects with backoff and never throws out.

const POLL_TIMEOUT_SEC = 25;
const MAX_BACKOFF_MS = 60_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function dispatchUpdate(
  db: PrismaClient,
  token: string,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  if (message?.text) {
    const chatId = String(message.chat.id);
    const replies = await handleTelegramUpdate(db, { chatId, text: message.text });
    for (const reply of replies) {
      await sendTelegramMessage(token, chatId, reply.text, reply.buttons ?? []);
    }
    return;
  }
  const callback = update.callback_query;
  if (callback) {
    const chatId = String(callback.message?.chat.id ?? callback.from.id);
    // Clear the button's spinner first (best-effort).
    await answerCallbackQuery(token, callback.id).catch(() => {});
    if (callback.data) {
      const replies = await handleTelegramCallback(db, { chatId, data: callback.data });
      for (const reply of replies) {
        await sendTelegramMessage(token, chatId, reply.text, reply.buttons ?? []);
      }
    }
  }
}

/**
 * Starts the poller (spec block 1). Returns a stop function for graceful shutdown.
 * No-op (logs «telegram disabled») when the token is unset or another worker
 * already holds the single-poller lock.
 */
export function startTelegramPoller(db: PrismaClient): () => void {
  const token = env.telegramBotToken;
  if (!token) {
    logger.info("telegram disabled — TELEGRAM_BOT_TOKEN not set");
    return () => {};
  }

  const lockDb = getTelegramLockClient();
  const lockKey = jobLockKey("telegramPoll");
  let running = true;
  let controller: AbortController | null = null;

  const stop = (): void => {
    running = false;
    controller?.abort();
    advisoryUnlock(lockDb, lockKey).catch(() => {});
  };

  void (async () => {
    let locked = false;
    try {
      locked = await tryAdvisoryLock(lockDb, lockKey);
    } catch (err) {
      logger.error({ err }, "telegram poller: could not acquire lock — not polling");
      return;
    }
    if (!locked) {
      logger.info("telegram poller: another instance holds the lock — not polling");
      return;
    }
    logger.info("telegram poller: started");
    try {
      // Long-poll and webhook are exclusive — drop any leftover webhook.
      await deleteTelegramWebhook(token);
    } catch (err) {
      logger.warn({ err }, "telegram poller: deleteWebhook failed (continuing)");
    }

    let offset = 0;
    let backoffMs = 0;
    while (running) {
      const ctrl = new AbortController();
      controller = ctrl;
      // Client-side guard slightly longer than the server long-poll timeout.
      const guard = setTimeout(() => ctrl.abort(), (POLL_TIMEOUT_SEC + 10) * 1000);
      try {
        const updates = await getTelegramUpdates(token, offset, POLL_TIMEOUT_SEC, ctrl.signal);
        backoffMs = 0;
        for (const update of updates) {
          offset = update.update_id + 1;
          if (!running) break;
          await dispatchUpdate(db, token, update).catch((err) =>
            logger.error({ err, updateId: update.update_id }, "telegram: update handler failed"),
          );
        }
      } catch (err) {
        if (!running) break;
        backoffMs = Math.min(backoffMs === 0 ? 1000 : backoffMs * 2, MAX_BACKOFF_MS);
        logger.warn({ err, backoffMs }, "telegram poller: getUpdates error — backing off");
        await sleep(backoffMs, ctrl.signal);
      } finally {
        clearTimeout(guard);
      }
    }
    logger.info("telegram poller: stopped");
  })();

  return stop;
}
