import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { EmailContent } from "@/emails/layout";
import {
  adminSecurityAlertEmail,
  inviteEmail,
  newDeviceEmail,
  passwordResetEmail,
  suspiciousBlockEmail,
} from "@/emails/templates";

// Email delivery (spec 18 + stage-9 changelog): Nodemailer over SMTP when
// SMTP_HOST is set, otherwise a jsonTransport that writes the whole message to
// the log — a working dev mode without SMTP, no crashes. Transactional auth
// emails (invite/reset/new_device/security) are sent directly here; notification
// emails go through the outbox and the worker emailDispatch job.

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;
  const smtp = env.smtp;
  if (!smtp.host) {
    // Dev / degraded mode: log the full message, never throw (changelog to §18).
    cachedTransport = nodemailer.createTransport({ jsonTransport: true });
  } else {
    cachedTransport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465, // implicit TLS on 465; STARTTLS otherwise
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    });
  }
  return cachedTransport;
}

/** Low-level send. Throws on SMTP failure (callers decide whether to swallow). */
export async function sendEmail(to: string, content: EmailContent): Promise<void> {
  const smtp = env.smtp;
  const info = await getTransport().sendMail({
    from: smtp.from,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  if (!smtp.host) {
    // jsonTransport: the rendered message rides on info.message (dev visibility).
    logger.info(
      { mail: { to, subject: content.subject } },
      "email (dev jsonTransport — SMTP not configured)",
    );
  } else {
    logger.info({ mail: { to, subject: content.subject, id: info.messageId } }, "email sent");
  }
}

/**
 * Transactional send that never breaks the caller: an SMTP failure is logged,
 * not thrown (email is a secondary channel — spec changelog to 7.1). Used for
 * auth/security emails fired from within Server Actions.
 */
async function sendEmailSafe(to: string, content: EmailContent): Promise<void> {
  try {
    await sendEmail(to, content);
  } catch (err) {
    logger.error({ err, to, subject: content.subject }, "email send failed (non-fatal)");
  }
}

export async function sendInviteEmail(to: string, name: string, inviteUrl: string): Promise<void> {
  await sendEmailSafe(to, inviteEmail(name, inviteUrl));
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmailSafe(to, passwordResetEmail(resetUrl));
}

export async function sendNewDeviceEmail(to: string, deviceLabel: string): Promise<void> {
  await sendEmailSafe(to, newDeviceEmail(deviceLabel));
}

export async function sendSuspiciousBlockEmail(to: string): Promise<void> {
  await sendEmailSafe(to, suspiciousBlockEmail());
}

export async function sendAdminSecurityAlertEmail(to: string, userEmail: string): Promise<void> {
  await sendEmailSafe(to, adminSecurityAlertEmail(userEmail));
}
