import { env } from "@/lib/env";
import { isRoomUrlReady } from "@/lib/constants";
import type { InlineButton } from "@/lib/services/telegram/api";

// Telegram message formatting (walk 13.3). Messages use parse_mode HTML — only
// dynamic text is escaped; structural <b> tags are literal. Keeps «терминология
// платформы, без эмодзи-фейерверков» (spec block 3): plain, tight, no emoji.

/** Escapes the 3 HTML specials Telegram's HTML parse mode needs. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Absolute link on PLATFORM_URL (spec block 2.2: «все ссылки на PLATFORM_URL»). */
export function platformUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = env.platformUrl.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Composes an HTML message block: a bold title and optional escaped body lines
 * (blank lines dropped). Callers pass already-plain (unescaped) strings.
 */
export function messageBlock(title: string, lines: (string | null | undefined)[] = []): string {
  const head = `<b>${escapeHtml(title)}</b>`;
  const body = lines
    .filter((line): line is string => Boolean(line && line.trim()))
    .map(escapeHtml)
    .join("\n");
  return body ? `${head}\n\n${body}` : head;
}

// Per-type inline-button captions (spec block 2.2). Fallback «Открыть».
const BUTTON_LABEL: Record<string, string> = {
  digest: "Начать",
  mock_24h: "Подключиться",
  mock_1h: "Подключиться",
  mock_feedback: "Читать",
  mock_booked: "Открыть бронь",
  mock_cancelled: "Открыть",
  mock_moved: "Открыть бронь",
  waitlist_offer: "Забронировать",
  access_14d: "Написать Диме",
  access_3d: "Написать Диме",
  access_0d: "Написать Диме",
};

/**
 * A renewal contact (RENEWAL_CONTACT) may be a URL, a @username or a bare email —
 * or plain prose («своему ментору»). Returns a button-usable URL, or null when it
 * is prose (the message body already names the contact, so no button is shown).
 */
export function contactAsUrl(contact: string | null | undefined): string | null {
  if (!contact) return null;
  const c = contact.trim();
  if (/^(https?:|tg:|mailto:)/i.test(c)) return c;
  if (/^@[A-Za-z0-9_]{3,}$/.test(c)) return `https://t.me/${c.slice(1)}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return `mailto:${c}`;
  return null;
}

/** Context the dispatch job resolves per notification for its button (spec block 2.2). */
export interface NotificationButtonContext {
  /** Booking room URL for mock_24h/mock_1h — «нет комнаты → без кнопки». */
  roomUrl?: string | null;
  /** RENEWAL_CONTACT for access_* — «[Написать Диме]». */
  renewalContact?: string | null;
}

export interface TelegramMessageSpec {
  text: string;
  buttons: InlineButton[];
}

/**
 * Turns a stored notification (already-rendered title/body/url) into a Telegram
 * message + at most one inline button (spec block 2.2). Platform links go through
 * PLATFORM_URL; mock reminders link to the room, access_* to the renewal contact.
 */
export function notificationMessage(
  row: { type: string; title: string; body: string; url: string | null },
  ctx: NotificationButtonContext = {},
): TelegramMessageSpec {
  const text = messageBlock(row.title, [row.body]);
  const button = notificationButton(row, ctx);
  return { text, buttons: button ? [button] : [] };
}

function notificationButton(
  row: { type: string; url: string | null },
  ctx: NotificationButtonContext,
): InlineButton | null {
  const label = BUTTON_LABEL[row.type] ?? "Открыть";

  if (row.type === "mock_24h" || row.type === "mock_1h") {
    // [Подключиться] → room_url; no room yet ⇒ no button (spec block 2.2).
    return ctx.roomUrl && isRoomUrlReady(ctx.roomUrl) ? { text: label, url: ctx.roomUrl } : null;
  }
  if (row.type === "access_14d" || row.type === "access_3d" || row.type === "access_0d") {
    const url = contactAsUrl(ctx.renewalContact);
    return url ? { text: label, url } : null;
  }
  return row.url ? { text: label, url: platformUrl(row.url) } : null;
}
