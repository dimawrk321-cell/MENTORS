// Date helpers (spec 0.6): storage is UTC, presentation is per-user timezone.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
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

/**
 * «5 октября 2026» for a calendar-date value stored as UTC midnight (`@db.Date`,
 * produced by dateOnlyUtc). Formatting such a value in the user's timezone would
 * shift it to the previous local day for zones west of UTC — a date-only column
 * already IS the user's calendar date, so it is rendered in UTC (spec 0.6).
 */
export function formatDateOnlyRu(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
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

/**
 * UTC instant of a local wall-clock time (YYYY-MM-DD + HH:MM) in a timezone —
 * the storage form of «время в TZ интервьюера» for slot materialization (spec
 * 0.6/7.8). Same convergent offset correction as zonedDateEndUtc (two passes
 * cover DST boundaries).
 */
export function zonedDateTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y = 1970, m = 1, d = 1] = dateStr.split("-").map(Number);
  const [hh = 0, mm = 0] = timeStr.split(":").map(Number);
  const desired = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = new Date(desired);
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

/** «14:32» — часы:минуты инстанта в таймзоне (чипы слотов в TZ ученика, spec 7.8). */
export function formatTimeRu(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

/** «вторник, 5 октября» — заголовок дня SlotPicker в TZ ученика (spec 7.8). */
export function formatDayHeadingRu(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
}

/** Calendar date «YYYY-MM-DD» of an instant in a timezone (spec 0.6: «сегодня» — в TZ пользователя). */
export function localDateStr(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * A calendar date as the UTC-midnight instant Prisma stores in `@db.Date`
 * columns — the storage form of «календарная дата в таймзоне пользователя».
 */
export function dateOnlyUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/** Hour (0–23) of an instant in a timezone — used by streak «под угрозой» / night_shift. */
export function localHour(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(hour);
}

/**
 * ISO weekday (1 = Monday … 7 = Sunday) of a calendar date «YYYY-MM-DD».
 * The string is already the user's local date, so this is timezone-independent —
 * matches `users.study_days` (spec 6: дни недели 1–7).
 */
export function isoWeekday(dateStr: string): number {
  return ((dateOnlyUtc(dateStr).getUTCDay() + 6) % 7) + 1;
}

/** UTC instants bounding a calendar date in a timezone: [start, end). */
export function zonedDayUtcRange(dateStr: string, timeZone: string): { start: Date; end: Date } {
  const previousDay = localDateStr(addDays(dateOnlyUtc(dateStr), -1), "UTC");
  return {
    start: zonedDateEndUtc(previousDay, timeZone),
    end: zonedDateEndUtc(dateStr, timeZone),
  };
}

/** Minutes since local midnight (0–1439) of an instant in a timezone. */
export function localMinutesOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** «HH:MM» → minutes since midnight (0–1439). Invalid input → 0. */
export function hhmmToMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Whether `now` falls inside the user's quiet-hours window (spec 7.12). The
 * window is defined by two local «HH:MM» bounds and may wrap midnight
 * (22:00–08:00). Equal bounds ⇒ empty window (never quiet).
 */
export function isWithinQuietHours(
  now: Date,
  timeZone: string,
  startHHMM: string,
  endHHMM: string,
): boolean {
  const startM = hhmmToMinutes(startHHMM);
  const endM = hhmmToMinutes(endHHMM);
  if (startM === endM) return false; // empty window
  const nowM = localMinutesOfDay(now, timeZone);
  return startM < endM
    ? nowM >= startM && nowM < endM // same-day window
    : nowM >= startM || nowM < endM; // wraps midnight
}

/**
 * UTC instant of the next local occurrence of «HH:MM» at/after `now` (spec 7.12:
 * deferred email is released when quiet hours end). If the target time already
 * passed today (local), it resolves to tomorrow's occurrence.
 */
export function nextLocalTimeUtc(now: Date, timeZone: string, timeHHMM: string): Date {
  const targetM = hhmmToMinutes(timeHHMM);
  const nowM = localMinutesOfDay(now, timeZone);
  const todayStr = localDateStr(now, timeZone);
  const dateStr =
    nowM < targetM ? todayStr : localDateStr(addDays(dateOnlyUtc(todayStr), 1), "UTC");
  return zonedDateTimeToUtc(dateStr, timeHHMM, timeZone);
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
