import type { CourseGating, Prisma } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/services/audit";
import {
  DEFAULT_XP_MAP,
  XP_MAP_KEYS,
  XP_VALUE_MAX,
  XP_VALUE_MIN,
  type XpMap,
  type XpMapKey,
} from "@/lib/services/xp";

// app_settings reader with the 60s cache required by spec 6 («читаются
// сервисами с кешем 60с»). Writes happen in seed/admin (stage 10) and are rare.

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return (hit.value as T) ?? fallback;
  }
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = row ? (row.value as T) : fallback;
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export const ACCESS_RULES_SETTING_KEY = "access_rules_text";

export const DEFAULT_ACCESS_RULES_TEXT =
  "Доступ к платформе персональный: аккаунтом пользуешься только ты, до двух устройств одновременно. " +
  "Материалы, вопросы и записи собеседований нельзя передавать третьим лицам и публиковать. " +
  "Нарушение правил ведёт к блокировке аккаунта без возврата оплаты.";

export async function getAccessRulesText(): Promise<string> {
  return getSetting<string>(ACCESS_RULES_SETTING_KEY, DEFAULT_ACCESS_RULES_TEXT);
}

// --- Stage 10.2: editable settings (app_settings overrides, audited writes) ---

export const RENEWAL_CONTACT_SETTING_KEY = "renewal_contact";
export const DEFAULT_COURSE_GATING_SETTING_KEY = "default_course_gating";

/**
 * Контакт продления (spec 8.5 / 10.2): app_settings перекрывает env, чтобы
 * менять без редеплоя. Пустое/отсутствующее значение в БД → фоллбэк на
 * `RENEWAL_CONTACT` из env (может быть null). Прямой запрос (без 60с-кеша) —
 * читается редко (истечение/письма/страница /expired), зато тестируется с db.
 */
export async function getRenewalContact(db: Db = prisma): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key: RENEWAL_CONTACT_SETTING_KEY } });
  const stored = typeof row?.value === "string" ? row.value.trim() : "";
  return stored || env.renewalContact;
}

const GATINGS: readonly CourseGating[] = ["strict", "recommended", "free"];

/** Дефолт гейтинга новых курсов (spec 8.5). app_settings → фоллбэк «strict». */
export async function getDefaultCourseGating(db: Db = prisma): Promise<CourseGating> {
  const row = await db.appSetting.findUnique({
    where: { key: DEFAULT_COURSE_GATING_SETTING_KEY },
  });
  const value = typeof row?.value === "string" ? row.value : null;
  return value && (GATINGS as readonly string[]).includes(value)
    ? (value as CourseGating)
    : "strict";
}

// --- Stage 12.1: editable XP map + operational rules (app_settings-first) ---
//
// DECISION (spec 12.1/C1-C2): these getters take `db` and read the raw value with
// the 60s cache ONLY when db is the prisma singleton (production); on an injected
// test db they read directly. That keeps the spec's «getSetting кеш 60с» in prod
// while letting the fallback unit-tests set a value in `mentors_test` and see it
// (services never read the singleton — see dev-ops memory). Writes go through
// upsertAppSetting, which invalidates the cache.

async function readRawSetting(db: Db, key: string): Promise<unknown> {
  if (db === prisma) return getSetting<unknown>(key, undefined);
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? undefined;
}

export const XP_MAP_SETTING_KEY = "xp_map";

/** Editable XP map (spec 12.1/C1): per-key override, validated int, fallback to code. */
export async function getXpMap(db: Db = prisma): Promise<XpMap> {
  const raw = await readRawSetting(db, XP_MAP_SETTING_KEY);
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const map = { ...DEFAULT_XP_MAP };
  for (const key of XP_MAP_KEYS) {
    const v = stored[key];
    if (typeof v === "number" && Number.isInteger(v) && v >= XP_VALUE_MIN && v <= XP_VALUE_MAX) {
      map[key as XpMapKey] = v;
    }
  }
  return map;
}

/**
 * Editable numeric operational rule (spec 12.1/C2): app_settings value if present
 * and an integer within [min,max], else the code-constant fallback.
 */
export async function getNumericSetting(
  db: Db,
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): Promise<number> {
  const raw = await readRawSetting(db, key);
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= bounds.min && raw <= bounds.max) {
    return raw;
  }
  return fallback;
}

// Operational-rule keys (spec 12.1/C2). Defaults/labels/bounds are assembled by the
// settings page from the owning services' code constants (single source of truth).
export const OPS_CANCEL_FREE_HOURS_KEY = "ops_cancel_free_hours";
export const OPS_STRIKE_LOCK_DAYS_KEY = "ops_strike_lock_days";
export const OPS_BOOKING_HORIZON_DAYS_KEY = "ops_booking_horizon_days";
export const OPS_NEW_CARDS_PER_DAY_KEY = "ops_new_cards_per_day";
export const OPS_STREAK_FREEZE_CAP_KEY = "ops_streak_freeze_cap";
export const DEFAULT_DIGEST_TIME_KEY = "ops_default_digest_time";

/**
 * Validation bounds for the editable operational rules (spec 12.1/C2). Single
 * source for the settings page and the save action. (Services duplicate these
 * inline in their getNumericSetting calls — keep them in sync.)
 */
export const OPS_BOUNDS: Record<string, { min: number; max: number }> = {
  [OPS_CANCEL_FREE_HOURS_KEY]: { min: 0, max: 168 },
  [OPS_STRIKE_LOCK_DAYS_KEY]: { min: 1, max: 365 },
  [OPS_BOOKING_HORIZON_DAYS_KEY]: { min: 1, max: 90 },
  [OPS_NEW_CARDS_PER_DAY_KEY]: { min: 1, max: 500 },
  [OPS_STREAK_FREEZE_CAP_KEY]: { min: 0, max: 10 },
};

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Editable platform-default digest time (spec 12.1/C2): HH:MM, fallback 09:00. */
export async function getDefaultDigestTime(db: Db = prisma): Promise<string> {
  const raw = await readRawSetting(db, DEFAULT_DIGEST_TIME_KEY);
  return typeof raw === "string" && HHMM_RE.test(raw) ? raw : "09:00";
}

/**
 * Upsert an app setting with an audit entry (spec 8.5: каждое сохранение — аудит)
 * and 60s-cache invalidation. Value is stored as JSON.
 */
export async function upsertAppSetting(
  db: Db,
  input: { actorId: string; key: string; value: Prisma.InputJsonValue },
): Promise<void> {
  const existing = await db.appSetting.findUnique({ where: { key: input.key } });
  await db.appSetting.upsert({
    where: { key: input.key },
    create: { key: input.key, value: input.value },
    update: { value: input.value },
  });
  await writeAudit(db, {
    actorId: input.actorId,
    action: "settings.updated",
    entityType: "app_setting",
    entityId: input.key,
    before: { value: (existing?.value as Prisma.InputJsonValue | undefined) ?? null },
    after: { value: input.value },
  });
  cache.delete(input.key);
}
