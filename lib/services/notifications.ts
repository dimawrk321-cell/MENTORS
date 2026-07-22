import type { Db } from "@/lib/db";
import { MOCK_TYPE_LABEL } from "@/lib/constants";
import { isWithinQuietHours, nextLocalTimeUtc, pluralRu } from "@/lib/utils/dates";

// Notifications service (spec 7.12). Single seam `notify(db, userId, type, payload)`
// replacing the stage-5/6 `enqueueNotification` stub. Responsibilities:
//   1. Gate by effective per-type channel prefs (table 7.12 + code defaults).
//   2. Render Russian title/body/url by type.
//   3. Write the in-app notification row immediately (bell).
//   4. Queue email in the outbox (same row) — sent now, or deferred past quiet
//      hours (spec 7.12); the worker `emailDispatch` job flushes it.
//   5. Emit `notification.sent` analytics per channel (без текста).
//
// DECISION: defaults live in code (NOTIFICATION_TYPES — the seeded constant);
// notification_prefs rows are per-user overrides for toggleable channels only.
// «Always»-типы игнорируют строку prefs (отключить нельзя). This satisfies «сид
// дефолтов» without materializing a row per (user, type).
//
// DECISION: notify() never routes through emitEvent — it writes analytics_events
// directly. events.ts → streak.ts → notifications.ts would otherwise cycle.

// --- Channel policy + type config (spec 7.12) ---

interface ChannelPolicy {
  /** Channel is usable for this type at all (spec 7.12 «Каналы default»). */
  available: boolean;
  /** Default enabled state. */
  default: boolean;
  /** User may change it in the profile matrix (false ⇒ «всегда», forced on). */
  toggleable: boolean;
}

interface NotificationTypeConfig {
  inapp: ChannelPolicy;
  email: ChannelPolicy;
}

const OFF: ChannelPolicy = { available: false, default: false, toggleable: false };
const ALWAYS_ON: ChannelPolicy = { available: true, default: true, toggleable: false };
const ON_TOGGLEABLE: ChannelPolicy = { available: true, default: true, toggleable: true };
const OFF_OPT_IN: ChannelPolicy = { available: true, default: false, toggleable: true };

// Table 7.12 (+ mock_booked changelog). new_device is email-only and delivered
// directly (transactional security email in auth.ts) — not routed through notify.
export const NOTIFICATION_TYPES = {
  digest: { inapp: ON_TOGGLEABLE, email: ON_TOGGLEABLE },
  mock_24h: { inapp: ON_TOGGLEABLE, email: ON_TOGGLEABLE },
  mock_1h: { inapp: ON_TOGGLEABLE, email: ON_TOGGLEABLE },
  mock_feedback: { inapp: ALWAYS_ON, email: ALWAYS_ON },
  mock_cancelled: { inapp: ALWAYS_ON, email: ALWAYS_ON },
  waitlist_offer: { inapp: ALWAYS_ON, email: ALWAYS_ON },
  mock_booked: { inapp: ALWAYS_ON, email: ALWAYS_ON },
  streak_risk: { inapp: OFF_OPT_IN, email: OFF },
  freeze_used: { inapp: ALWAYS_ON, email: OFF },
  // D7 (spec 13.1): «Новый титул» — celebratory in-app, always on, no email.
  level_title: { inapp: ALWAYS_ON, email: OFF },
  lesson_new: { inapp: ON_TOGGLEABLE, email: OFF },
  lesson_updated: { inapp: ON_TOGGLEABLE, email: OFF },
  access_14d: { inapp: ALWAYS_ON, email: ALWAYS_ON },
  access_3d: { inapp: ALWAYS_ON, email: ALWAYS_ON },
  access_0d: { inapp: ALWAYS_ON, email: ALWAYS_ON },
  announcement: { inapp: ALWAYS_ON, email: OFF },
  // Admin-facing (spec 7.15 linkRotationReminder): in-app to admin+, always on;
  // not in the student profile matrix.
  link_rotation: { inapp: ALWAYS_ON, email: OFF },
} satisfies Record<string, NotificationTypeConfig>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/**
 * Types whose email must NOT be deferred past quiet hours (§9 acceptance fix): a
 * mock reminder arriving after the mock is worse than not arriving. In quiet
 * hours their email is dropped entirely (the in-app copy still fires immediately).
 * All other types defer their email to the end of quiet hours as usual.
 */
export const EMAIL_NON_DEFERRABLE: ReadonlySet<NotificationType> = new Set(["mock_1h", "mock_24h"]);

// --- Per-type payloads (data needed to render Russian title/body/url) ---

export interface NotifyPayloads {
  digest: { count: number; estimateMin: number };
  mock_24h: { bookingId: string; whenText: string };
  mock_1h: { bookingId: string; whenText: string };
  mock_booked:
    | { role: "student"; bookingId: string; whenText: string; mockType: string }
    | { role: "interviewer"; whenText: string; mockType: string; studentName: string };
  mock_feedback: { bookingId: string };
  mock_cancelled: { audience: "interviewer"; by: "student" | "system" } | { audience: "student" };
  waitlist_offer: Record<string, never>;
  streak_risk: { current: number };
  freeze_used: { freezesLeft: number };
  level_title: { level: number; title: string };
  lesson_new: { lessonId: string; lessonTitle: string; courseTitle: string };
  lesson_updated: { lessonId: string; lessonTitle: string };
  access_14d: { untilText: string; contact: string };
  access_3d: { untilText: string; contact: string };
  access_0d: { untilText: string; contact: string };
  announcement: { announcementId: string; title: string; bodyText: string; url: string | null };
  link_rotation: { count: number };
}

interface RenderedNotification {
  title: string;
  body: string;
  url: string | null;
}

function mockLabel(type: string): string {
  return MOCK_TYPE_LABEL[type] ?? type;
}

/** Renders Russian title/body/url for a notification (spec 7.12). */
export function renderNotification<T extends NotificationType>(
  type: T,
  payload: NotifyPayloads[T],
): RenderedNotification {
  switch (type) {
    case "digest": {
      const p = payload as NotifyPayloads["digest"];
      const cards = pluralRu(p.count, "карточка", "карточки", "карточек");
      return {
        title: "Повторения на сегодня",
        body: `Сегодня к повторению: ${p.count} ${cards} (~${p.estimateMin} мин)`,
        url: "/trainer/session",
      };
    }
    case "mock_24h": {
      const p = payload as NotifyPayloads["mock_24h"];
      return {
        title: "Мок завтра",
        body: `Напоминание: мок ${p.whenText}. Не забудь подключиться.`,
        url: `/mocks/${p.bookingId}`,
      };
    }
    case "mock_1h": {
      const p = payload as NotifyPayloads["mock_1h"];
      return {
        title: "Мок через час",
        body: `Мок начнётся ${p.whenText}. Кнопка «Подключиться» откроется за 15 минут до старта.`,
        url: `/mocks/${p.bookingId}`,
      };
    }
    case "mock_booked": {
      const p = payload as NotifyPayloads["mock_booked"];
      if (p.role === "student") {
        return {
          title: "Мок забронирован",
          body: `${mockLabel(p.mockType)} · ${p.whenText}`,
          url: `/mocks/${p.bookingId}`,
        };
      }
      return {
        title: "Новая бронь мока",
        body: `${p.studentName} · ${mockLabel(p.mockType)} · ${p.whenText}`,
        url: "/interviewer/bookings",
      };
    }
    case "mock_feedback": {
      const p = payload as NotifyPayloads["mock_feedback"];
      return {
        title: "Фидбек по моку готов",
        body: "Интервьюер опубликовал разбор — посмотри оценки и рекомендованные уроки.",
        url: `/mocks/${p.bookingId}`,
      };
    }
    case "mock_cancelled": {
      const p = payload as NotifyPayloads["mock_cancelled"];
      if (p.audience === "student") {
        return {
          title: "Интервьюер отменил мок",
          body: "Твоя заявка в листе ожидания получила приоритет.",
          url: "/mocks/mine",
        };
      }
      if (p.by === "system") {
        return {
          title: "Мок отменён: у ученика истёк доступ",
          body: "Слот освобождён и предложен листу ожидания.",
          url: "/interviewer/bookings",
        };
      }
      return {
        title: "Ученик отменил мок",
        body: "Слот освобождён.",
        url: "/interviewer/bookings",
      };
    }
    case "waitlist_offer":
      return {
        title: "Освободился слот для мока",
        body: "Успей забронировать — предложение действует 2 часа.",
        url: "/mocks/book",
      };
    case "streak_risk": {
      const p = payload as NotifyPayloads["streak_risk"];
      const days = pluralRu(p.current, "день", "дня", "дней");
      return {
        title: "Серия под угрозой",
        body: `Твоя серия — ${p.current} ${days}. Позанимайся сегодня, чтобы её сохранить.`,
        url: "/trainer",
      };
    }
    case "freeze_used": {
      const p = payload as NotifyPayloads["freeze_used"];
      const left = pluralRu(p.freezesLeft, "заморозка", "заморозки", "заморозок");
      return {
        title: "Серия спасена заморозкой",
        body: `Осталось ${p.freezesLeft} ${left}.`,
        url: "/",
      };
    }
    case "level_title": {
      const p = payload as NotifyPayloads["level_title"];
      return {
        title: "Новый титул",
        body: `Уровень ${p.level}: «${p.title}».`,
        url: "/",
      };
    }
    case "lesson_new": {
      const p = payload as NotifyPayloads["lesson_new"];
      return {
        title: "Новый урок",
        body: `«${p.lessonTitle}» в курсе «${p.courseTitle}».`,
        url: `/lessons/${p.lessonId}`,
      };
    }
    case "lesson_updated": {
      const p = payload as NotifyPayloads["lesson_updated"];
      return {
        title: "Урок обновлён",
        body: `«${p.lessonTitle}» — материал дополнен, загляни.`,
        url: `/lessons/${p.lessonId}`,
      };
    }
    case "access_14d": {
      const p = payload as NotifyPayloads["access_14d"];
      return {
        title: `Доступ действует до ${p.untilText}`,
        body: `Чтобы продлить — напиши ${p.contact}.`,
        url: "/profile",
      };
    }
    case "access_3d": {
      const p = payload as NotifyPayloads["access_3d"];
      return {
        title: "Доступ заканчивается через 3 дня",
        body: `Доступ действует до ${p.untilText}. Чтобы продлить — напиши ${p.contact}.`,
        url: "/profile",
      };
    }
    case "access_0d": {
      const p = payload as NotifyPayloads["access_0d"];
      return {
        title: "Сегодня последний день доступа",
        body: `Доступ действует до ${p.untilText}. Чтобы продлить — напиши ${p.contact}.`,
        url: "/profile",
      };
    }
    case "announcement": {
      const p = payload as NotifyPayloads["announcement"];
      return { title: p.title, body: p.bodyText, url: p.url };
    }
    case "link_rotation": {
      const p = payload as NotifyPayloads["link_rotation"];
      const recs = pluralRu(p.count, "запись", "записи", "записей");
      return {
        title: "Записи со старыми ссылками",
        body: `Пора обновить ссылки: ${p.count} ${recs} старше 30 дней.`,
        url: "/admin/library",
      };
    }
    default: {
      // Exhaustiveness guard — new types must add a case above.
      const _never: never = type;
      return { title: String(_never), body: "", url: null };
    }
  }
}

// --- Effective prefs (code defaults overlaid by DB override rows) ---

export interface EffectivePref {
  inapp: boolean;
  email: boolean;
}

function channelState(policy: ChannelPolicy, stored: boolean | undefined): boolean {
  if (!policy.available) return false;
  if (!policy.toggleable) return policy.default; // «всегда» — stored row ignored
  return stored ?? policy.default;
}

/** Resolves a user's effective channels for a type (spec 7.12). */
export async function resolveEffectivePref(
  db: Db,
  userId: string,
  type: NotificationType,
): Promise<EffectivePref> {
  const config = NOTIFICATION_TYPES[type];
  const row = await db.notificationPref.findUnique({
    where: { userId_type: { userId, type } },
    select: { inapp: true, email: true },
  });
  return {
    inapp: channelState(config.inapp, row?.inapp),
    email: channelState(config.email, row?.email),
  };
}

// --- notify() ---

/**
 * Single delivery seam (spec 7.12). Gates by prefs, writes the in-app row and/or
 * queues email (deferred past quiet hours, except time-sensitive types which are
 * dropped instead — §9 acceptance fix), records `notification.sent`. Safe to
 * call inside a caller transaction — no network I/O (email is flushed by the
 * worker). No-op when nothing would be delivered or the user is missing.
 *
 * `opts.emailDeadline` marks the email's relevance horizon (for mock_* — the
 * booking start): emailDispatch skips a pending email past it.
 */
export async function notify<T extends NotificationType>(
  db: Db,
  userId: string,
  type: T,
  payload: NotifyPayloads[T],
  opts: { now?: Date; emailDeadline?: Date | null } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const pref = await resolveEffectivePref(db, userId, type);
  if (!pref.inapp && !pref.email) return;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { timezone: true, quietHoursStart: true, quietHoursEnd: true },
  });
  if (!user) return;

  const { title, body, url } = renderNotification(type, payload);

  // In-app is created immediately; email scheduling (spec 7.12 + §9 acceptance fix).
  let emailPending = false;
  let scheduledAt: Date | null = null;
  if (pref.email) {
    const inQuiet = isWithinQuietHours(
      now,
      user.timezone,
      user.quietHoursStart,
      user.quietHoursEnd,
    );
    if (inQuiet && EMAIL_NON_DEFERRABLE.has(type)) {
      // Time-sensitive: deferring past quiet hours would arrive after the mock —
      // drop the email entirely (the in-app copy still notifies immediately).
      emailPending = false;
    } else {
      emailPending = true;
      scheduledAt = inQuiet ? nextLocalTimeUtc(now, user.timezone, user.quietHoursEnd) : now;
    }
  }

  // Nothing to deliver (e.g. in-app off + email dropped in quiet hours) → no row.
  if (!pref.inapp && !emailPending) return;

  await db.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      url,
      inApp: pref.inapp,
      emailPending,
      scheduledAt,
      emailDeadline: emailPending ? (opts.emailDeadline ?? null) : null,
    },
  });

  // notification.sent per channel — без текста (spec 7.13/task «События»).
  const channels: ("inapp" | "email")[] = [];
  if (pref.inapp) channels.push("inapp");
  if (emailPending) channels.push("email");
  for (const channel of channels) {
    await db.analyticsEvent.create({
      data: { type: "notification.sent", payload: { notifType: type, channel }, userId },
    });
  }
}

// --- Bell queries (spec 7.12) ---

export const BELL_RECENT_LIMIT = 20;

export async function getUnreadCount(db: Db, userId: string): Promise<number> {
  return db.notification.count({ where: { userId, inApp: true, readAt: null } });
}

export async function getRecentNotifications(db: Db, userId: string) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId, inApp: true },
      orderBy: { createdAt: "desc" },
      take: BELL_RECENT_LIMIT,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        url: true,
        readAt: true,
        createdAt: true,
      },
    }),
    getUnreadCount(db, userId),
  ]);
  return { items, unread };
}

/**
 * Last N sent notifications for a user — the admin student-card «Уведомления»
 * view (spec 8.5 stage-10: разборы «мне не пришло»). Both channels, any status.
 */
export async function getRecentSentNotifications(db: Db, userId: string, take = 30) {
  return db.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      title: true,
      inApp: true,
      readAt: true,
      emailPending: true,
      emailSentAt: true,
      scheduledAt: true,
      createdAt: true,
    },
  });
}

/** Marks in-app notifications read (spec 7.12): specific ids or all of a user's. */
export async function markNotificationsRead(
  db: Db,
  userId: string,
  input: { ids?: string[]; all?: boolean },
): Promise<number> {
  const now = new Date();
  const where =
    input.all || !input.ids
      ? { userId, inApp: true, readAt: null }
      : { userId, inApp: true, readAt: null, id: { in: input.ids } };
  const res = await db.notification.updateMany({ where, data: { readAt: now } });
  return res.count;
}

// --- Profile matrix (spec 7.12: only toggleable types/channels) ---

export interface MatrixChannel {
  /** Channel is rendered (available + toggleable). */
  shown: boolean;
  /** Current effective value. */
  value: boolean;
}

export interface MatrixRow {
  type: NotificationType;
  label: string;
  description: string;
  inapp: MatrixChannel;
  email: MatrixChannel;
}

const MATRIX_META: Record<string, { label: string; description: string }> = {
  digest: {
    label: "Дайджест повторений",
    description: "Утреннее письмо и уведомление: сколько карточек ждёт повторения.",
  },
  lesson_new: {
    label: "Новые уроки",
    description: "Когда в твоих курсах публикуется новый урок.",
  },
  lesson_updated: {
    label: "Обновления уроков",
    description: "Когда обновляется урок, который ты уже прошёл.",
  },
  mock_24h: { label: "Напоминание о моке за 24 часа", description: "За сутки до мок-интервью." },
  mock_1h: { label: "Напоминание о моке за час", description: "За час до мок-интервью." },
  streak_risk: {
    label: "Серия под угрозой",
    description: "Вечером, если день ещё не засчитан, а серия может прерваться.",
  },
};

/** Ordered toggleable rows for the profile settings matrix (spec 8.3/7.12). */
export const MATRIX_ORDER: NotificationType[] = [
  "digest",
  "lesson_new",
  "lesson_updated",
  "mock_24h",
  "mock_1h",
  "streak_risk",
];

export async function getNotificationMatrix(db: Db, userId: string): Promise<MatrixRow[]> {
  const rows = await db.notificationPref.findMany({
    where: { userId, type: { in: MATRIX_ORDER } },
    select: { type: true, inapp: true, email: true },
  });
  const byType = new Map(rows.map((r) => [r.type, r]));
  return MATRIX_ORDER.map((type) => {
    const config = NOTIFICATION_TYPES[type];
    const stored = byType.get(type);
    const meta = MATRIX_META[type]!;
    return {
      type,
      label: meta.label,
      description: meta.description,
      inapp: {
        shown: config.inapp.available && config.inapp.toggleable,
        value: channelState(config.inapp, stored?.inapp),
      },
      email: {
        shown: config.email.available && config.email.toggleable,
        value: channelState(config.email, stored?.email),
      },
    };
  });
}

/**
 * Applies a submitted matrix (spec 9 updateNotificationPrefs). Only toggleable
 * channels are honored; non-toggleable/unavailable channels are stored at their
 * forced state so the row stays consistent. Ignores unknown types.
 */
export async function updateNotificationPrefs(
  db: Db,
  userId: string,
  submitted: Partial<Record<NotificationType, { inapp?: boolean; email?: boolean }>>,
): Promise<void> {
  for (const type of MATRIX_ORDER) {
    const config = NOTIFICATION_TYPES[type];
    const input = submitted[type];
    if (!input) continue;
    const inapp = config.inapp.toggleable
      ? Boolean(input.inapp)
      : config.inapp.available && config.inapp.default;
    const email = config.email.toggleable
      ? Boolean(input.email)
      : config.email.available && config.email.default;
    await db.notificationPref.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, inapp, email },
      update: { inapp, email },
    });
  }
}
