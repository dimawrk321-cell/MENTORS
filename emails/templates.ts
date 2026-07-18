import { env } from "@/lib/env";
import { buildEmail, type EmailContent } from "@/emails/layout";

// Per-type email templates (spec 7.12/18). Auth/transactional emails render
// directly; notification-type emails share a body shaped from the stored
// notification (title/body/url) with a type-specific subject + CTA label.
// Тон — короткий, спокойный, без маркетинга (spec 7.12).

const brand = () => env.brandName;

export function inviteEmail(name: string, inviteUrl: string): EmailContent {
  return buildEmail(`${brand()} — приглашение`, {
    title: `Привет, ${name}!`,
    paragraphs: [
      `Тебя пригласили на платформу ${brand()}. Открой ссылку и задай пароль, чтобы начать.`,
    ],
    cta: { label: "Установить пароль", path: inviteUrl },
    note: "Ссылка действует 7 дней. Если она устареет — попроси новую.",
  });
}

export function passwordResetEmail(resetUrl: string): EmailContent {
  return buildEmail(`${brand()} — сброс пароля`, {
    title: "Сброс пароля",
    paragraphs: ["Ты запросил сброс пароля. Открой ссылку, чтобы задать новый."],
    cta: { label: "Сбросить пароль", path: resetUrl },
    note: "Ссылка действует 1 час. Если это был не ты — просто проигнорируй письмо.",
  });
}

export function newDeviceEmail(deviceLabel: string): EmailContent {
  return buildEmail(`${brand()} — вход с нового устройства`, {
    title: "Вход с нового устройства",
    paragraphs: [
      `Выполнен вход с нового устройства: ${deviceLabel}.`,
      "Если это ты — всё в порядке. Если нет — смени пароль и напиши нам.",
    ],
    cta: { label: "Открыть профиль", path: "/profile" },
  });
}

export function suspiciousBlockEmail(renewalContact: string | null): EmailContent {
  const contact = renewalContact ? ` Свяжись с нами: ${renewalContact}.` : "";
  return buildEmail(`${brand()} — аккаунт заблокирован`, {
    title: "Замечена подозрительная активность",
    paragraphs: [
      `Аккаунт временно заблокирован из соображений безопасности.${contact}`,
      "Напиши нам, чтобы разобраться и восстановить доступ.",
    ],
  });
}

export function adminSecurityAlertEmail(userEmail: string): EmailContent {
  return buildEmail(`${brand()} — авто-блокировка по security-флагу`, {
    title: "Авто-блокировка ученика",
    paragraphs: [
      `Пользователь ${userEmail} автоматически заблокирован: повторный гео-флаг за 7 дней.`,
    ],
    cta: { label: "Открыть админку", path: "/admin" },
  });
}

// --- Notification-type emails (rendered by the worker emailDispatch job) ---

interface NotificationEmailStyle {
  cta: string;
}

// CTA label per notification type; subject is the notification title itself
// (already a clean Russian phrase). Email-off types never reach here.
const NOTIFICATION_EMAIL_STYLE: Record<string, NotificationEmailStyle> = {
  digest: { cta: "Открыть тренажёр" },
  mock_24h: { cta: "Открыть бронь" },
  mock_1h: { cta: "Открыть бронь" },
  mock_booked: { cta: "Открыть бронь" },
  mock_feedback: { cta: "Смотреть фидбек" },
  mock_cancelled: { cta: "Открыть" },
  waitlist_offer: { cta: "Забронировать слот" },
  access_14d: { cta: "Открыть профиль" },
  access_3d: { cta: "Открыть профиль" },
  access_0d: { cta: "Открыть профиль" },
  announcement: { cta: "Открыть" },
};

/** Renders a stored notification into an email (spec 7.12). */
export function notificationEmail(input: {
  type: string;
  title: string;
  body: string;
  url: string | null;
}): EmailContent {
  const style = NOTIFICATION_EMAIL_STYLE[input.type];
  return buildEmail(input.title, {
    title: input.title,
    paragraphs: input.body ? [input.body] : [],
    cta: input.url ? { label: style?.cta ?? "Открыть", path: input.url } : undefined,
  });
}
