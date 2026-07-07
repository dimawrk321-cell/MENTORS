// Single place that reads process.env (spec 18); no secrets are ever inlined.

export const env = {
  get brandName(): string {
    return process.env.BRAND_NAME ?? "MENTORS";
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
  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
};
