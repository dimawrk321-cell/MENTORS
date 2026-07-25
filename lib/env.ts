// Single place that reads process.env (spec 18); no secrets are ever inlined.

export const env = {
  get brandName(): string {
    return process.env.BRAND_NAME ?? "PRIME";
  },
  get platformUrl(): string {
    return process.env.PLATFORM_URL ?? "http://localhost:3000";
  },
  /** tg/mail link shown on /expired, in blocked messages and reminders (spec 7.1). */
  get renewalContact(): string | null {
    return process.env.RENEWAL_CONTACT || null;
  },
  get geoipDbPath(): string | null {
    return process.env.GEOIP_DB_PATH || null;
  },
  /**
   * Telegram bot (walk 13.3, spec 7.12/V1). The token gates the whole channel:
   * unset ⇒ the worker logs «telegram disabled» and never starts the poller, and
   * telegramDispatch is a no-op — the channel is silently off (mirrors SMTP-null).
   * Never printed to logs/chat; lives only in env (.env.prod on the server).
   */
  get telegramBotToken(): string | null {
    return process.env.TELEGRAM_BOT_TOKEN || null;
  },
  /** Bot @username for the t.me/<username>?start=<code> deep link (default baked in). */
  get telegramBotUsername(): string {
    return process.env.TELEGRAM_BOT_USERNAME ?? "GeniusPRIMEE_BOT";
  },
  /**
   * SMTP config (spec 18). When `host` is unset the mailer falls back to
   * Nodemailer's jsonTransport (logs the message) — a working dev mode without
   * SMTP (stage-9 changelog to section 18).
   */
  get smtp(): {
    host: string | null;
    port: number;
    user: string | null;
    pass: string | null;
    from: string;
  } {
    return {
      host: process.env.SMTP_HOST || null,
      port: Number(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER || null,
      pass: process.env.SMTP_PASS || null,
      from: process.env.SMTP_FROM || `${this.brandName} <no-reply@localhost>`,
    };
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
