import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

// DECISION: until stage 9 (SMTP + templates in /emails) every email is a dev
// stub that writes the full message to the log — the spec changelog fixes the
// invite link in the admin UI as the primary channel until then.

interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

async function sendMail(message: MailMessage): Promise<void> {
  logger.info({ mail: message }, "email (dev stub — SMTP delivery arrives at stage 9)");
}

export async function sendInviteEmail(to: string, name: string, inviteUrl: string): Promise<void> {
  await sendMail({
    to,
    subject: `${env.brandName} — приглашение на платформу`,
    text: `Привет, ${name}!\n\nТебя пригласили на платформу ${env.brandName}. Установи пароль по ссылке (действует 7 дней):\n${inviteUrl}`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendMail({
    to,
    subject: `${env.brandName} — сброс пароля`,
    text: `Ссылка для сброса пароля (действует 1 час):\n${resetUrl}\n\nЕсли ты не запрашивал сброс — просто проигнорируй это письмо.`,
  });
}

export async function sendNewDeviceEmail(to: string, deviceLabel: string): Promise<void> {
  await sendMail({
    to,
    subject: `${env.brandName} — вход с нового устройства`,
    text: `Выполнен вход с нового устройства ${deviceLabel}. Если это не ты — смени пароль и напиши нам.`,
  });
}

export async function sendSuspiciousBlockEmail(to: string): Promise<void> {
  const contact = env.renewalContact ? ` Свяжись с нами: ${env.renewalContact}` : "";
  await sendMail({
    to,
    subject: `${env.brandName} — аккаунт заблокирован`,
    text: `Замечена подозрительная активность, аккаунт временно заблокирован. Напиши нам, чтобы разобраться.${contact}`,
  });
}

export async function sendAdminSecurityAlertEmail(to: string, userEmail: string): Promise<void> {
  await sendMail({
    to,
    subject: `${env.brandName} — авто-блокировка по security-флагу`,
    text: `Пользователь ${userEmail} автоматически заблокирован: повторный гео-флаг за 7 дней. Детали — в админке.`,
  });
}

/** Stage-9 job will schedule these; the stub keeps the access lifecycle complete (spec 7.1.3). */
export async function sendAccessExpiryReminderEmail(
  to: string,
  accessUntilText: string,
): Promise<void> {
  const contact = env.renewalContact ?? "своему ментору";
  await sendMail({
    to,
    subject: `${env.brandName} — доступ действует до ${accessUntilText}`,
    text: `Доступ действует до ${accessUntilText}. Чтобы продлить — напиши ${contact}.`,
  });
}
