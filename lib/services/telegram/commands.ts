import type { PrismaClient } from "@prisma/client";
import { MOCK_TYPE_LABEL, isRoomUrlReady } from "@/lib/constants";
import { formatDateTimeRu, formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import { processStreakDay, getStreakState } from "@/lib/services/streak";
import { getTodayXp } from "@/lib/services/xp";
import { getSrsQueue, getNextReviewDate } from "@/lib/services/srs";
import { getActiveBooking } from "@/lib/services/mocks";
import { getContinueTarget } from "@/lib/services/dashboard";
import type { InlineButton } from "@/lib/services/telegram/api";
import { messageBlock, platformUrl } from "@/lib/services/telegram/format";
import {
  consumeLinkCode,
  resolveLinkedUserId,
  unlinkTelegram,
} from "@/lib/services/telegram/linking";

// Bot commands (walk 13.3 block 3). «Пульт и колокольчик»: read + jump to the
// platform, never act. Every reply ≤ one screen, platform terminology, no emoji
// fireworks. Handlers are pure — they read services and return OutgoingMessages;
// the poller does the sending (so this is unit-testable without the network).

/** How early «Подключиться» appears before a mock (mirrors the dashboard: 15 min). */
const CONNECT_LEAD_MS = 15 * 60 * 1000;
/** «Мок в течение часа» window for the /today Подключиться button (spec block 3.1). */
const WITHIN_HOUR_MS = 60 * 60 * 1000;

export const TG_CALLBACK_UNLINK = "tg:unlink";
export const TG_CALLBACK_CANCEL = "tg:cancel";
export const TG_CALLBACK_REFRESH_TODAY = "tg:refresh:today";

// Persistent reply-keyboard tiles (walk 13.5 block 3.1): 4 главные плашки в 2 ряда.
// Тап шлёт текст плашки как обычное сообщение → мапится на тот же хендлер, что
// одноимённая команда (block 3.2). Мок/Помощь остаются командами (block 3.4).
export const TELEGRAM_TILES = {
  today: "📊 Сегодня",
  queue: "🎯 Очередь",
  streak: "🔥 Серия",
  progress: "📈 Прогресс",
} as const;

/** Label rows for the persistent reply keyboard (sent by the poller). */
export const TELEGRAM_REPLY_KEYBOARD: string[][] = [
  [TELEGRAM_TILES.today, TELEGRAM_TILES.queue],
  [TELEGRAM_TILES.streak, TELEGRAM_TILES.progress],
];

/** Tile label → the command whose handler it mirrors (block 3.2). */
const TILE_TO_COMMAND: Record<string, string> = {
  [TELEGRAM_TILES.today]: "/today",
  [TELEGRAM_TILES.queue]: "/queue",
  [TELEGRAM_TILES.streak]: "/streak",
  [TELEGRAM_TILES.progress]: "/progress",
};

export interface OutgoingMessage {
  text: string;
  buttons?: InlineButton[];
  /**
   * Attach the persistent reply keyboard to this message (block 3.1). Set only on
   * an inline-free reply — Telegram forbids inline + reply keyboard on one message;
   * `is_persistent` keeps the tiles docked for the inline-only replies.
   */
  replyKeyboard?: boolean;
}

/**
 * Marks the first inline-free reply of a linked-user batch to carry the tiles.
 * DECISION: Telegram allows one reply_markup per message, so the persistent tiles
 * can't ride a reply that already has inline buttons; `is_persistent` keeps them
 * docked once any inline-free reply has seeded them. New links are seeded on the
 * spot (linkedConfirmation is inline-free). A user linked BEFORE this walk whose
 * chat never received the markup sees the tiles on their first inline-free reply
 * (/streak, an empty /queue, or an unknown command) — a one-time transitional gap,
 * not per-message noise; an all-inline command like /today alone won't seed them.
 */
function withKeyboard(replies: OutgoingMessage[]): OutgoingMessage[] {
  const target = replies.find((reply) => !reply.buttons || reply.buttons.length === 0);
  if (target) target.replyKeyboard = true;
  return replies;
}

interface CommandUser {
  id: string;
  name: string;
  timezone: string;
  studyDays: number[];
  dailyGoalXp: number;
  track: "ds" | "nlp" | "ai" | null;
}

async function loadCommandUser(db: PrismaClient, userId: string): Promise<CommandUser | null> {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      timezone: true,
      studyDays: true,
      dailyGoalXp: true,
      track: true,
    },
  });
}

function parseCommand(raw: string): { command: string; arg: string } {
  const text = raw.trim();
  if (!text.startsWith("/")) return { command: "", arg: text };
  const spaceIdx = text.indexOf(" ");
  const head = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();
  // Strip a @bot suffix (/today@GeniusPRIMEE_BOT) and lowercase.
  const command = head.split("@")[0]!.toLowerCase();
  return { command, arg };
}

const days = (n: number) => pluralRu(n, "день", "дня", "дней");
const cards = (n: number) => pluralRu(n, "карточка", "карточки", "карточек");

// --- Card of the day (/today, and after a successful /start link) ---

export async function buildTodayCard(
  db: PrismaClient,
  userId: string,
  now: Date,
): Promise<OutgoingMessage> {
  const user = await loadCommandUser(db, userId);
  if (!user) return connectPrompt();

  // Lazy end-of-day resolver must run before reading streak state (spec/dashboard).
  await processStreakDay(db, { userId, now });
  const [streak, todayXp, queue, mock, cont] = await Promise.all([
    getStreakState(db, { userId, now, timezone: user.timezone, studyDays: user.studyDays }),
    getTodayXp(db, userId, now, user.timezone),
    getSrsQueue(db, { userId, now }),
    getActiveBooking(db, userId, now),
    getContinueTarget(db, userId, user.track),
  ]);

  const streakLine =
    `Серия: ${streak.current} ${days(streak.current)}` +
    (streak.freezes > 0 ? ` · заморозок: ${streak.freezes}` : "") +
    (streak.atRisk ? " · под угрозой" : "");
  const goalMet = todayXp >= user.dailyGoalXp;
  const goalLine = `Цель дня: ${todayXp} / ${user.dailyGoalXp} XP${goalMet ? " — закрыта" : ""}`;
  const queueLine =
    queue.total > 0
      ? `Очередь: ${queue.total} ${cards(queue.total)} · ~${queue.estimateMinutes} мин`
      : "Очередь: пусто — всё повторено";
  const mockLine = mock
    ? `Ближайший мок: ${MOCK_TYPE_LABEL[mock.type] ?? mock.type}, ${formatDateTimeRu(mock.startsAt, user.timezone)}`
    : "Ближайший мок: нет";

  const text = messageBlock("Сегодня", [streakLine, goalLine, queueLine, mockLine]);

  // [Подключиться] when a mock is within the hour and its room is ready, else [Начать].
  const mockSoon =
    mock &&
    isRoomUrlReady(mock.roomUrl) &&
    mock.startsAt.getTime() - now.getTime() <= WITHIN_HOUR_MS;
  let button: InlineButton;
  if (mockSoon) {
    button = { text: "Подключиться", url: mock!.roomUrl };
  } else if (queue.total > 0) {
    button = { text: "Начать", url: platformUrl("/trainer/session") };
  } else if (cont) {
    button = { text: "Начать", url: platformUrl(`/lessons/${cont.lessonId}`) };
  } else {
    button = { text: "Открыть PRIME", url: platformUrl("/") };
  }
  // [Начать] + [🔄 Обновить] (walk 13.5 block 3.3): 2 max in a row.
  return {
    text,
    buttons: [button, { text: "🔄 Обновить", callbackData: TG_CALLBACK_REFRESH_TODAY }],
  };
}

async function buildQueue(
  db: PrismaClient,
  user: CommandUser,
  now: Date,
): Promise<OutgoingMessage> {
  const queue = await getSrsQueue(db, { userId: user.id, now });
  if (queue.total > 0) {
    return {
      text: messageBlock("Очередь повторений", [
        `${queue.total} ${cards(queue.total)} · ~${queue.estimateMinutes} мин`,
      ]),
      buttons: [{ text: "Начать", url: platformUrl("/trainer/session") }],
    };
  }
  const next = await getNextReviewDate(db, { userId: user.id, now });
  const nextLine = next ? `Следующие карточки: ${formatDateOnlyRu(next)}.` : null;
  return { text: messageBlock("Очередь повторений", ["Пусто — всё повторено.", nextLine]) };
}

async function buildStreak(
  db: PrismaClient,
  user: CommandUser,
  now: Date,
): Promise<OutgoingMessage> {
  await processStreakDay(db, { userId: user.id, now });
  const streak = await getStreakState(db, {
    userId: user.id,
    now,
    timezone: user.timezone,
    studyDays: user.studyDays,
  });
  return {
    text: messageBlock("Серия", [
      `Текущая: ${streak.current} ${days(streak.current)}`,
      `Рекорд: ${streak.best} ${days(streak.best)}`,
      `Заморозки: ${streak.freezes}`,
      streak.atRisk ? "Серия под угрозой — позанимайся сегодня, чтобы её сохранить." : null,
    ]),
  };
}

async function buildMock(db: PrismaClient, user: CommandUser, now: Date): Promise<OutgoingMessage> {
  const mock = await getActiveBooking(db, user.id, now);
  if (!mock) {
    return {
      text: messageBlock("Ближайший мок", ["Броней нет."]),
      buttons: [{ text: "Забронировать", url: platformUrl("/mocks/book") }],
    };
  }
  const text = messageBlock("Ближайший мок", [
    `${MOCK_TYPE_LABEL[mock.type] ?? mock.type} · ${formatDateTimeRu(mock.startsAt, user.timezone)}`,
    `Интервьюер: ${mock.interviewerName}`,
  ]);
  const connectable =
    isRoomUrlReady(mock.roomUrl) &&
    now.getTime() >= mock.startsAt.getTime() - CONNECT_LEAD_MS &&
    now.getTime() < mock.endsAt.getTime();
  const button: InlineButton = connectable
    ? { text: "Подключиться", url: mock.roomUrl }
    : { text: "Открыть бронь", url: platformUrl(`/mocks/${mock.bookingId}`) };
  return { text, buttons: [button] };
}

async function buildProgress(db: PrismaClient, user: CommandUser): Promise<OutgoingMessage> {
  const cont = await getContinueTarget(db, user.id, user.track);
  if (!cont) {
    return {
      text: messageBlock("Прогресс", ["Пока нет начатых уроков — начни первый на платформе."]),
      buttons: [{ text: "Начать обучение", url: platformUrl("/") }],
    };
  }
  const pct = cont.moduleTotal > 0 ? Math.round((cont.moduleDone / cont.moduleTotal) * 100) : 0;
  return {
    text: messageBlock("Прогресс", [
      `Курс: ${cont.courseTitle}`,
      `Модуль «${cont.moduleTitle}»: ${cont.moduleDone}/${cont.moduleTotal} (${pct}%)`,
      `Следующий урок: ${cont.lessonTitle}`,
    ]),
    buttons: [
      {
        text: cont.mode === "continue" ? "Продолжить" : "Начать",
        url: platformUrl(`/lessons/${cont.lessonId}`),
      },
    ],
  };
}

function buildHelp(): OutgoingMessage {
  return {
    text: messageBlock("Команды", [
      "/today — карточка дня",
      "/queue — очередь повторений",
      "/streak — серия и заморозки",
      "/mock — ближайший мок",
      "/progress — прогресс по курсу",
      "/stop — отключить уведомления",
      "/help — эта справка",
      "",
      "Действовать и учиться — на платформе.",
    ]),
    buttons: [{ text: "Открыть PRIME", url: platformUrl("/") }],
  };
}

function connectPrompt(): OutgoingMessage {
  return {
    text: messageBlock("PRIME", [
      "Подключи бота в профиле на платформе — тогда я смогу показывать прогресс и присылать уведомления.",
    ]),
    buttons: [{ text: "Открыть профиль", url: platformUrl("/profile") }],
  };
}

function badCode(): OutgoingMessage {
  return {
    text: messageBlock("Код не подошёл", [
      "Код устарел или уже использован. Открой профиль на платформе и нажми «Подключить Telegram» ещё раз.",
    ]),
    buttons: [{ text: "Открыть профиль", url: platformUrl("/profile") }],
  };
}

function linkedConfirmation(): OutgoingMessage {
  return {
    text: messageBlock("Telegram подключён", [
      "Готово. Буду присылать уведомления сюда. Команды — /help.",
    ]),
  };
}

function stopConfirm(): OutgoingMessage {
  return {
    text: messageBlock("Отключить Telegram?", [
      "Уведомления перестанут приходить сюда. Снова подключить можно в профиле.",
    ]),
    buttons: [
      { text: "Отключить", callbackData: TG_CALLBACK_UNLINK },
      { text: "Отмена", callbackData: TG_CALLBACK_CANCEL },
    ],
  };
}

function unknownCommand(): OutgoingMessage {
  return { text: "Не знаю такой команды. Вот что я умею — /help" };
}

/**
 * Routes one incoming message to reply message(s) (spec block 3). Resolves the
 * chat → user; unlinked chats get exactly one polite «подключись» reply for any
 * message (except a valid /start code, which links). Returns the messages to send.
 */
export async function handleTelegramUpdate(
  db: PrismaClient,
  input: { chatId: string; text: string; now?: Date },
): Promise<OutgoingMessage[]> {
  const now = input.now ?? new Date();
  const { command, arg } = parseCommand(input.text);

  if (command === "/start") {
    if (arg) {
      const res = await consumeLinkCode(db, { code: arg, chatId: input.chatId, now });
      if (res.ok && res.userId) {
        return withKeyboard([linkedConfirmation(), await buildTodayCard(db, res.userId, now)]);
      }
      // Invalid code — but the chat may already be linked (stale deep link).
      const linked = await resolveLinkedUserId(db, input.chatId);
      return linked ? withKeyboard([await buildTodayCard(db, linked, now)]) : [badCode()];
    }
    const linked = await resolveLinkedUserId(db, input.chatId);
    return linked ? withKeyboard([await buildTodayCard(db, linked, now)]) : [connectPrompt()];
  }

  const userId = await resolveLinkedUserId(db, input.chatId);
  if (!userId) return [connectPrompt()];

  if (command === "/stop") return withKeyboard([stopConfirm()]);

  const user = await loadCommandUser(db, userId);
  if (!user) return [connectPrompt()];

  // A tile tap arrives as its plain label (no «/») — route it to the same handler
  // as the matching command (block 3.2); the «/…» commands keep working in parallel.
  const effective = command || TILE_TO_COMMAND[input.text.trim()] || "";

  switch (effective) {
    case "/today":
      return withKeyboard([await buildTodayCard(db, userId, now)]);
    case "/queue":
      return withKeyboard([await buildQueue(db, user, now)]);
    case "/streak":
      return withKeyboard([await buildStreak(db, user, now)]);
    case "/mock":
      return withKeyboard([await buildMock(db, user, now)]);
    case "/progress":
      return withKeyboard([await buildProgress(db, user)]);
    case "/help":
      return withKeyboard([buildHelp()]);
    default:
      return withKeyboard([unknownCommand()]);
  }
}

/**
 * Routes an inline-button callback: «Обновить» (rebuild the day card — the poller
 * edits it in place, block 3.3) and the /stop confirm. Returns reply message(s).
 */
export async function handleTelegramCallback(
  db: PrismaClient,
  input: { chatId: string; data: string; now?: Date },
): Promise<OutgoingMessage[]> {
  if (input.data === TG_CALLBACK_REFRESH_TODAY) {
    const userId = await resolveLinkedUserId(db, input.chatId);
    if (!userId) return [connectPrompt()];
    return [await buildTodayCard(db, userId, input.now ?? new Date())];
  }
  if (input.data === TG_CALLBACK_UNLINK) {
    const userId = await resolveLinkedUserId(db, input.chatId);
    if (!userId) return [{ text: "Уже отключено." }];
    await unlinkTelegram(db, userId);
    return [
      {
        text: messageBlock("Telegram отключён", [
          "Уведомления сюда больше не приходят. Снова подключить — в профиле на платформе.",
        ]),
        buttons: [{ text: "Открыть профиль", url: platformUrl("/profile") }],
      },
    ];
  }
  if (input.data === TG_CALLBACK_CANCEL) {
    return [{ text: "Отключение отменено." }];
  }
  return [];
}
