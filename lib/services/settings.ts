import type { CourseGating } from "@prisma/client";
import { prisma, type Db } from "@/lib/db";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/services/audit";

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

/**
 * Upsert an app setting with an audit entry (spec 8.5: каждое сохранение — аудит)
 * and 60s-cache invalidation. Value is stored as JSON.
 */
export async function upsertAppSetting(
  db: Db,
  input: { actorId: string; key: string; value: string },
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
    before: { value: (existing?.value as string | null) ?? null },
    after: { value: input.value },
  });
  cache.delete(input.key);
}
