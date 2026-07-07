import { prisma } from "@/lib/db";

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
