// Date helpers (spec 0.6): storage is UTC, presentation is per-user timezone.

export const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** «5 октября 2026» in the user's timezone. */
export function formatDateRu(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(date);
}

/** «5 окт, 14:32» in the user's timezone. */
export function formatDateTimeRu(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

/** Whole days between now and a deadline, negative when past. */
export function daysUntil(until: Date, now: Date = new Date()): number {
  return Math.ceil((until.getTime() - now.getTime()) / DAY_MS);
}

/**
 * UTC instant when the given calendar date (YYYY-MM-DD) ends in a timezone —
 * i.e. the next local midnight. Used for «продлить до даты»: access lasts
 * through the chosen day in the student's timezone (spec 0.6).
 */
export function zonedDateEndUtc(dateStr: string, timeZone: string): Date {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  const desired = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  let guess = new Date(desired);
  // Convergent offset correction (two passes cover DST boundaries).
  for (let i = 0; i < 2; i += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(guess);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const actual = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    const diff = desired - actual;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/** Russian pluralization: pluralRu(5, "день", "дня", "дней") → «дней». */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
