import type { AvailabilityException, AvailabilityRule, PrismaClient } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  addDays,
  addMinutes,
  dateOnlyUtc,
  isoWeekday,
  localDateStr,
  zonedDateTimeToUtc,
} from "@/lib/utils/dates";
import {
  MOCK_DURATION_MINUTES,
  SCHEDULE_PREVIEW_DAYS,
  SLOT_GRID_MINUTES,
  SLOT_HORIZON_DAYS,
} from "@/lib/constants";
import { getNumericSetting, OPS_BOOKING_HORIZON_DAYS_KEY } from "@/lib/services/settings";

// Слоты моков (spec 7.8). Интервьюер задаёт повторяющиеся окна (availability_rules)
// и исключения (day_off / extra); worker материализует слоты на 14 дней вперёд по
// сетке 75 мин. Времена правил — «HH:MM» локально для интервьюера; материализация
// конвертирует их в UTC-инстанты (spec 0.6). Пересборка трогает только свободные
// будущие слоты (open); booked/closed сохраняются.

// --- Чистое ядро сетки (юнит-тесты) ---

/** «HH:MM» → минуты от полуночи (0..1439); null при неверном формате. */
export function parseTimeToMinutes(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Минуты от полуночи → «HH:MM». */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface GridWindow {
  startMinutes: number;
  endMinutes: number;
}

/**
 * Нарезка окна на сетку 75 мин (spec 7.8): слот стартует на startMinutes, затем
 * +75, +150, … пока `start + 60 ≤ end`. 18:00–21:00 (1080–1260) → [1080, 1155]
 * (18:00 и 19:15).
 */
export function gridStartsForWindow(window: GridWindow): number[] {
  const starts: number[] = [];
  for (
    let start = window.startMinutes;
    start + MOCK_DURATION_MINUTES <= window.endMinutes;
    start += SLOT_GRID_MINUTES
  ) {
    starts.push(start);
  }
  return starts;
}

/**
 * Эффективные окна доступности на конкретную локальную дату (spec 7.8):
 * повторяющиеся правила недели + extra-окна этой даты.
 * DECISION: day_off — «весь день выходной»: снимает и повторяющиеся правила, и
 * extra-окна этой даты. Иначе «Закрыть день» (добавляет day_off) не смог бы
 * надёжно закрыть день с extra-окном — ежедневный slotsGenerate переоткрыл бы
 * его слоты. Сценарий «выходной, но одна доп-сессия» выражается просто extra-окном
 * в день без повторяющегося правила (day_off не нужен).
 */
export function effectiveWindowsForDate(
  dateStr: string,
  rules: Pick<AvailabilityRule, "weekday" | "startTime" | "endTime" | "active">[],
  exceptions: Pick<AvailabilityException, "date" | "kind" | "startTime" | "endTime">[],
): GridWindow[] {
  const weekday = isoWeekday(dateStr);
  const hasDayOff = exceptions.some(
    (e) => e.kind === "day_off" && localDateStr(e.date, "UTC") === dateStr,
  );
  if (hasDayOff) return [];

  const windows: GridWindow[] = [];
  const push = (startTime: string | null, endTime: string | null) => {
    if (!startTime || !endTime) return;
    const start = parseTimeToMinutes(startTime);
    const end = parseTimeToMinutes(endTime);
    if (start === null || end === null || start >= end) return;
    windows.push({ startMinutes: start, endMinutes: end });
  };

  for (const rule of rules) {
    if (rule.active && rule.weekday === weekday) push(rule.startTime, rule.endTime);
  }
  for (const exception of exceptions) {
    if (exception.kind === "extra" && localDateStr(exception.date, "UTC") === dateStr) {
      push(exception.startTime, exception.endTime);
    }
  }
  return windows;
}

export interface ComputedSlot {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Целевой набор слотов интервьюера на горизонт (spec 7.8): чистая функция от
 * правил/исключений/TZ/now — только будущие старты, дедуплицированные по времени.
 */
export function computeTargetSlots(input: {
  timezone: string;
  now: Date;
  rules: Pick<AvailabilityRule, "weekday" | "startTime" | "endTime" | "active">[];
  exceptions: Pick<AvailabilityException, "date" | "kind" | "startTime" | "endTime">[];
  horizonDays?: number;
}): ComputedSlot[] {
  const horizon = input.horizonDays ?? SLOT_HORIZON_DAYS;
  const todayStr = localDateStr(input.now, input.timezone);
  const byTime = new Map<number, ComputedSlot>();

  for (let d = 0; d < horizon; d += 1) {
    const dateStr = localDateStr(addDays(dateOnlyUtc(todayStr), d), "UTC");
    for (const window of effectiveWindowsForDate(dateStr, input.rules, input.exceptions)) {
      for (const startMin of gridStartsForWindow(window)) {
        const startsAt = zonedDateTimeToUtc(dateStr, minutesToTime(startMin), input.timezone);
        if (startsAt <= input.now) continue; // только будущие слоты (spec 7.8)
        byTime.set(startsAt.getTime(), {
          startsAt,
          endsAt: addMinutes(startsAt, MOCK_DURATION_MINUTES),
        });
      }
    }
  }
  return [...byTime.values()].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// --- Материализация (spec 7.8): идемпотентно, только future open пересобираются ---

export interface GenerateSlotsResult {
  created: number;
  removed: number;
}

async function loadAvailability(db: Db, interviewerId: string) {
  const [rules, exceptions] = await Promise.all([
    db.availabilityRule.findMany({ where: { interviewerId } }),
    db.availabilityException.findMany({ where: { interviewerId } }),
  ]);
  return { rules, exceptions };
}

/**
 * Пересобирает слоты интервьюера на 14 дней вперёд (spec 7.8). Идемпотентно:
 * open-слоты, выпавшие из целевого набора, удаляются; недостающие целевые
 * создаются как open; booked/closed слоты сохраняются нетронутыми (пересборка
 * трогает только свободные будущие слоты). Только для is_interviewer.
 */
export async function generateSlots(
  db: Db,
  input: { interviewerId: string; now?: Date },
): Promise<GenerateSlotsResult> {
  const now = input.now ?? new Date();
  const interviewer = await db.user.findUnique({
    where: { id: input.interviewerId },
    select: { timezone: true, isInterviewer: true },
  });
  if (!interviewer || !interviewer.isInterviewer) return { created: 0, removed: 0 };

  const { rules, exceptions } = await loadAvailability(db, input.interviewerId);
  const horizonDays = await getNumericSetting(db, OPS_BOOKING_HORIZON_DAYS_KEY, SLOT_HORIZON_DAYS, {
    min: 1,
    max: 90,
  });
  const targets = computeTargetSlots({
    timezone: interviewer.timezone,
    now,
    rules,
    exceptions,
    horizonDays,
  });
  const targetByTime = new Map(targets.map((t) => [t.startsAt.getTime(), t]));

  const existing = await db.slot.findMany({
    where: { interviewerId: input.interviewerId, startsAt: { gt: now } },
  });
  const existingTimes = new Set(existing.map((s) => s.startsAt.getTime()));

  // Свободные будущие слоты вне целевого набора (окно сузилось/правило снято) — удаляем.
  let toRemove = existing
    .filter((s) => s.status === "open" && !targetByTime.has(s.startsAt.getTime()))
    .map((s) => s.id);
  // 13.2 audit: a slot held by an active waitlist offer stays status="open"
  // during the ~2h hold. Deleting it would SetNull offeredSlotId and strand the
  // waitlist row in status="offered" (a phantom offer until it expires). Keep
  // any open slot that currently backs an active offer.
  if (toRemove.length > 0) {
    const held = await db.waitlist.findMany({
      where: { status: "offered", offeredSlotId: { in: toRemove }, offerExpiresAt: { gt: now } },
      select: { offeredSlotId: true },
    });
    if (held.length > 0) {
      const heldIds = new Set(held.map((w) => w.offeredSlotId));
      toRemove = toRemove.filter((id) => !heldIds.has(id));
    }
  }
  let removed = 0;
  if (toRemove.length > 0) {
    removed = (await db.slot.deleteMany({ where: { id: { in: toRemove } } })).count;
  }

  // Недостающие целевые старты (нет слота любого статуса) — создаём как open.
  const toCreate = targets.filter((t) => !existingTimes.has(t.startsAt.getTime()));
  let created = 0;
  if (toCreate.length > 0) {
    created = (
      await db.slot.createMany({
        data: toCreate.map((t) => ({
          interviewerId: input.interviewerId,
          startsAt: t.startsAt,
          endsAt: t.endsAt,
          status: "open" as const,
        })),
        skipDuplicates: true,
      })
    ).count;
  }

  return { created, removed };
}

/** Джоба slotsGenerate (spec 7.15): материализация для всех интервьюеров. */
export async function generateAllSlots(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const interviewers = await db.user.findMany({
    where: { isInterviewer: true },
    select: { id: true },
  });
  for (const interviewer of interviewers) {
    await generateSlots(db, { interviewerId: interviewer.id, now });
  }
  return interviewers.length;
}

// --- Availability CRUD (интервьюер) — каждая мутация пересобирает слоты ---

export interface AvailabilityRuleInput {
  interviewerId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  now?: Date;
}

export type AvailabilityResult = { ok: true } | { ok: false; code: "invalid_window" };

function isValidWindow(startTime: string, endTime: string): boolean {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  return start !== null && end !== null && start < end;
}

/** Добавляет правило доступности и пересобирает слоты (spec 8.4). */
export async function addAvailabilityRule(
  db: PrismaClient,
  input: AvailabilityRuleInput,
): Promise<AvailabilityResult> {
  if (input.weekday < 1 || input.weekday > 7 || !isValidWindow(input.startTime, input.endTime)) {
    return { ok: false, code: "invalid_window" };
  }
  await db.availabilityRule.create({
    data: {
      interviewerId: input.interviewerId,
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
    },
  });
  await generateSlots(db, { interviewerId: input.interviewerId, now: input.now });
  return { ok: true };
}

/** Удаляет правило (только своё) и пересобирает слоты. */
export async function deleteAvailabilityRule(
  db: PrismaClient,
  input: { interviewerId: string; ruleId: string; now?: Date },
): Promise<AvailabilityResult> {
  const rule = await db.availabilityRule.findUnique({ where: { id: input.ruleId } });
  if (!rule || rule.interviewerId !== input.interviewerId) return { ok: true };
  await db.availabilityRule.delete({ where: { id: input.ruleId } });
  await generateSlots(db, { interviewerId: input.interviewerId, now: input.now });
  return { ok: true };
}

export interface ExceptionInput {
  interviewerId: string;
  /** «YYYY-MM-DD» в TZ интервьюера. */
  date: string;
  kind: "day_off" | "extra";
  startTime?: string;
  endTime?: string;
  now?: Date;
}

/** Добавляет исключение (day_off/extra) и пересобирает слоты (spec 8.4). */
export async function addAvailabilityException(
  db: PrismaClient,
  input: ExceptionInput,
): Promise<AvailabilityResult> {
  if (input.kind === "extra" && (!input.startTime || !input.endTime)) {
    return { ok: false, code: "invalid_window" };
  }
  if (input.kind === "extra" && !isValidWindow(input.startTime!, input.endTime!)) {
    return { ok: false, code: "invalid_window" };
  }
  const date = dateOnlyUtc(input.date);
  // day_off идемпотентен: не плодим повторяющиеся выходные на одну дату.
  if (input.kind === "day_off") {
    const existing = await db.availabilityException.findFirst({
      where: { interviewerId: input.interviewerId, date, kind: "day_off" },
    });
    if (existing) return { ok: true };
  }
  await db.availabilityException.create({
    data: {
      interviewerId: input.interviewerId,
      date,
      kind: input.kind,
      startTime: input.kind === "extra" ? input.startTime : null,
      endTime: input.kind === "extra" ? input.endTime : null,
    },
  });
  await generateSlots(db, { interviewerId: input.interviewerId, now: input.now });
  return { ok: true };
}

/** Удаляет исключение (только своё) и пересобирает слоты. */
export async function deleteAvailabilityException(
  db: PrismaClient,
  input: { interviewerId: string; exceptionId: string; now?: Date },
): Promise<AvailabilityResult> {
  const exception = await db.availabilityException.findUnique({ where: { id: input.exceptionId } });
  if (!exception || exception.interviewerId !== input.interviewerId) return { ok: true };
  await db.availabilityException.delete({ where: { id: input.exceptionId } });
  await generateSlots(db, { interviewerId: input.interviewerId, now: input.now });
  return { ok: true };
}

// --- Предпросмотр расписания (spec 8.4): персистентные будущие слоты по дням ---

export interface SchedulePreviewSlot {
  id: string;
  startsAt: Date;
  status: "open" | "booked" | "closed";
}

export interface SchedulePreviewDay {
  dateStr: string;
  slots: SchedulePreviewSlot[];
}

/** Слоты интервьюера на 2 недели вперёд, сгруппированные по его локальным дням. */
export async function getSchedulePreview(
  db: Db,
  input: { interviewerId: string; timezone: string; now?: Date },
): Promise<SchedulePreviewDay[]> {
  const now = input.now ?? new Date();
  const horizonEnd = addDays(now, SCHEDULE_PREVIEW_DAYS + 1);
  const slots = await db.slot.findMany({
    where: {
      interviewerId: input.interviewerId,
      startsAt: { gt: now, lt: horizonEnd },
    },
    orderBy: { startsAt: "asc" },
  });

  const byDay = new Map<string, SchedulePreviewSlot[]>();
  for (const slot of slots) {
    const dateStr = localDateStr(slot.startsAt, input.timezone);
    const list = byDay.get(dateStr) ?? [];
    list.push({ id: slot.id, startsAt: slot.startsAt, status: slot.status });
    byDay.set(dateStr, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dateStr, list]) => ({ dateStr, slots: list }));
}
