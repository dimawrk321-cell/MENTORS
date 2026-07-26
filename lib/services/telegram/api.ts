// Telegram Bot API transport (walk 13.3, spec 7.12/V1 external channel).
//
// DECISION (bot library): a zero-dependency raw `fetch` client, NOT grammY/telegraf.
// The spec lets the implementer pick a light library or an equivalent; a thin
// in-house client is the lightest «аналог». Rationale:
//   • the bot's surface is narrow — getUpdates long-poll + sendMessage with a 1–2
//     button inline keyboard + answerCallbackQuery — trivial over global fetch (Node 22);
//   • zero new dependency keeps the self-hosted supply chain minimal (matches the
//     codebase: nodemailer is the only outbound-channel dep), no pnpm build-approval;
//   • a single `callTelegram()` seam is trivially mockable, satisfying the spec's
//     «локально — тестовый режим без токена, API мокается» without library scaffolding;
//   • full control over reconnect/backoff, offset commit and 403-blocked detection.
// No telemetry leaves the box beyond api.telegram.org calls (spec 0.7 preserved).

const API_BASE = "https://api.telegram.org";

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

export class TelegramApiError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly method: string,
  ) {
    super(`telegram ${method} failed (${code}): ${description}`);
    this.name = "TelegramApiError";
  }

  /**
   * The chat is unreachable for good — user blocked/deleted the bot, or was
   * deactivated (all surface as HTTP 403). Triggers a soft auto-unlink so we stop
   * queueing telegram sends for this user (spec 13.3 block 2.3).
   */
  get isUnreachable(): boolean {
    return this.code === 403;
  }
}

/** Low-level Bot API call. Resolves with `result`; throws TelegramApiError on any non-ok. */
export async function callTelegram<T = unknown>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: { signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: opts.signal,
    });
  } catch (err) {
    // Network error or aborted long-poll — code 0 marks a transport failure the
    // poller retries with backoff (never a "blocked" auto-unlink).
    throw new TelegramApiError(0, err instanceof Error ? err.message : "network error", method);
  }
  const json = (await res.json().catch(() => null)) as TelegramResponse<T> | null;
  if (!json || !json.ok) {
    throw new TelegramApiError(
      json?.error_code ?? res.status,
      json?.description ?? `HTTP ${res.status}`,
      method,
    );
  }
  return json.result as T;
}

// --- Update / message shapes (only the fields the bot reads) ---

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/** An inline-keyboard button — a deep link (url) or a callback (callbackData). */
export type InlineButton = { text: string; url: string } | { text: string; callbackData: string };

function toKeyboardButton(button: InlineButton): Record<string, string> {
  return "url" in button
    ? { text: button.text, url: button.url }
    : { text: button.text, callback_data: button.callbackData };
}

/**
 * Persistent reply-keyboard markup (walk 13.5 block 3.1) from label rows. Telegram
 * shows these tiles docked under the input; `is_persistent` keeps them across
 * messages, so we only re-affirm them on inline-free replies.
 */
function replyKeyboardMarkup(rows: string[][]): Record<string, unknown> {
  return {
    keyboard: rows.map((row) => row.map((label) => ({ text: label }))),
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * Sends an HTML message with an optional single row of inline buttons (spec 13.3
 * block 2.2: 1–2 max) OR a persistent reply keyboard (walk 13.5 block 3.1) — never
 * both (Telegram allows one `reply_markup`); inline wins when both are passed.
 * Dynamic text must already be HTML-escaped by the caller (see telegram/format.ts).
 * Throws TelegramApiError (403 ⇒ unreachable).
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  buttons: InlineButton[] = [],
  replyKeyboard?: string[][],
): Promise<void> {
  const params: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (buttons.length > 0) {
    params.reply_markup = { inline_keyboard: [buttons.map(toKeyboardButton)] };
  } else if (replyKeyboard) {
    params.reply_markup = replyKeyboardMarkup(replyKeyboard);
  }
  await callTelegram(token, "sendMessage", params);
}

/**
 * Edits a sent message's text + inline buttons in place (walk 13.5 block 3.3:
 * «Обновить перерисовывает карточку»). Best-effort — the caller swallows the
 * «message is not modified» 400 when nothing changed.
 */
export async function editMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  buttons: InlineButton[] = [],
): Promise<void> {
  const params: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (buttons.length > 0) {
    params.reply_markup = { inline_keyboard: [buttons.map(toKeyboardButton)] };
  }
  await callTelegram(token, "editMessageText", params);
}

/** Acknowledges a callback query (clears the button's loading spinner). Best-effort. */
export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegram(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

/** Long-poll for updates (spec 13.3 block 1.1). `signal` aborts on shutdown. */
export async function getTelegramUpdates(
  token: string,
  offset: number,
  timeoutSec: number,
  signal?: AbortSignal,
): Promise<TelegramUpdate[]> {
  return callTelegram<TelegramUpdate[]>(
    token,
    "getUpdates",
    { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] },
    { signal },
  );
}

/** Drops any leftover webhook so getUpdates works (long-poll and webhook are exclusive). */
export async function deleteTelegramWebhook(token: string): Promise<void> {
  await callTelegram(token, "deleteWebhook", { drop_pending_updates: false });
}
