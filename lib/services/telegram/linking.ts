import type { PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import { env } from "@/lib/env";
import { generateToken, sha256Hex } from "@/lib/utils/crypto";
import { writeAudit } from "@/lib/services/audit";

// Telegram account linking (walk 13.3, spec block 1.3). One-time code from the
// profile → t.me/<bot>?start=<code> deep link → /start binds the chat to the
// issuing account (TTL 10 min, single-use). chat_id is audited only hashed.

/** One-time linking code TTL (spec 13.3 block 1.2): 10 minutes. */
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/** t.me deep link that carries the code as the /start payload. */
export function buildDeepLink(code: string): string {
  return `https://t.me/${env.telegramBotUsername}?start=${code}`;
}

export interface LinkCode {
  code: string;
  deepLink: string;
  expiresAt: Date;
}

/**
 * Issues a fresh linking code for the user (profile «Подключить»). Supersedes any
 * of the user's earlier unused codes so only the newest one works. The code is a
 * base64url random token — telegram-`start`-safe, unguessable, single-use + 10-min TTL.
 */
export async function createLinkCode(
  db: Db,
  userId: string,
  opts: { now?: Date } = {},
): Promise<LinkCode> {
  const now = opts.now ?? new Date();
  await db.telegramLinkCode.deleteMany({ where: { userId, usedAt: null } });
  const code = generateToken();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db.telegramLinkCode.create({ data: { userId, code, expiresAt } });
  return { code, deepLink: buildDeepLink(code), expiresAt };
}

/**
 * Consumes a /start code and links the chat (spec 13.3 block 1.3). Atomic + one-time:
 * a conditional updateMany claims the code (unused + unexpired) so a replay/race gets
 * `ok:false`; then the chat is freed from any prior owner and (re)pointed at this user
 * (chat_id + user_id are both unique). Audited with the hashed chat_id.
 */
export async function consumeLinkCode(
  db: PrismaClient,
  input: { code: string; chatId: string; now?: Date },
): Promise<{ ok: boolean; userId?: string }> {
  const now = input.now ?? new Date();
  const { code, chatId } = input;
  return db.$transaction(async (tx) => {
    const claimed = await tx.telegramLinkCode.updateMany({
      where: { code, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return { ok: false };
    const row = await tx.telegramLinkCode.findUnique({
      where: { code },
      select: { userId: true },
    });
    if (!row) return { ok: false };
    // Free the chat from any previous account, then (re)point this user's one link.
    await tx.telegramLink.deleteMany({ where: { chatId } });
    await tx.telegramLink.upsert({
      where: { userId: row.userId },
      create: { userId: row.userId, chatId, linkedAt: now },
      update: { chatId, linkedAt: now },
    });
    await writeAudit(tx, {
      actorId: row.userId,
      action: "telegram.linked",
      entityType: "user",
      entityId: row.userId,
      after: { chatIdHash: sha256Hex(chatId) },
    });
    return { ok: true, userId: row.userId };
  });
}

/**
 * Removes the user's Telegram link (profile «Отключить», /stop, or the auto-unlink
 * on a blocked chat — spec 13.3 block 2.3). Idempotent; audited with the hashed chat_id.
 * `actorId` defaults to the user (system-initiated unlinks use the affected user).
 */
export async function unlinkTelegram(
  db: Db,
  userId: string,
  opts: { actorId?: string; reason?: string } = {},
): Promise<boolean> {
  const existing = await db.telegramLink.findUnique({
    where: { userId },
    select: { chatId: true },
  });
  if (!existing) return false;
  const res = await db.telegramLink.deleteMany({ where: { userId } });
  if (res.count === 0) return false;
  await writeAudit(db, {
    actorId: opts.actorId ?? userId,
    action: "telegram.unlinked",
    entityType: "user",
    entityId: userId,
    before: { chatIdHash: sha256Hex(existing.chatId) },
    ...(opts.reason ? { after: { reason: opts.reason } } : {}),
  });
  return true;
}

/** Resolves the linked user for an incoming chat (poller/commands). null ⇒ not linked. */
export async function resolveLinkedUserId(db: Db, chatId: string): Promise<string | null> {
  const link = await db.telegramLink.findUnique({
    where: { chatId },
    select: { userId: true },
  });
  return link?.userId ?? null;
}

/** Link status for the profile «Telegram» block. */
export async function getTelegramLinkStatus(
  db: Db,
  userId: string,
): Promise<{ linked: boolean; linkedAt: Date | null }> {
  const link = await db.telegramLink.findUnique({
    where: { userId },
    select: { linkedAt: true },
  });
  return { linked: Boolean(link), linkedAt: link?.linkedAt ?? null };
}
