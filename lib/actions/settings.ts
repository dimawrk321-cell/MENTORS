"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  ACCESS_RULES_SETTING_KEY,
  DEFAULT_COURSE_GATING_SETTING_KEY,
  DEFAULT_DIGEST_TIME_KEY,
  OPS_BOUNDS,
  RENEWAL_CONTACT_SETTING_KEY,
  XP_MAP_SETTING_KEY,
  upsertAppSetting,
} from "@/lib/services/settings";
import { DEFAULT_XP_MAP, XP_MAP_KEYS, type XpMapKey } from "@/lib/services/xp";
import {
  ActionError,
  parseInput,
  requireActionRole,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import {
  operationalSettingsSchema,
  updateSettingsSchema,
  xpMapSchema,
} from "@/lib/utils/validation";

// /admin/settings mutations (spec 8.5). admin+. Each changed field is upserted +
// audited (upsertAppSetting handles both); unchanged fields are left untouched so
// the audit log isn't flooded with no-op saves.

export async function updateSettingsAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("admin");
    const parsed = parseInput(updateSettingsSchema, input);

    const rows = await prisma.appSetting.findMany({
      where: {
        key: {
          in: [
            RENEWAL_CONTACT_SETTING_KEY,
            ACCESS_RULES_SETTING_KEY,
            DEFAULT_COURSE_GATING_SETTING_KEY,
          ],
        },
      },
    });
    const current = new Map(rows.map((r) => [r.key, r.value]));

    const updates: { key: string; value: string }[] = [
      { key: RENEWAL_CONTACT_SETTING_KEY, value: parsed.renewalContact },
      { key: ACCESS_RULES_SETTING_KEY, value: parsed.accessRulesText },
      { key: DEFAULT_COURSE_GATING_SETTING_KEY, value: parsed.defaultCourseGating },
    ];
    for (const u of updates) {
      if (current.get(u.key) !== u.value) {
        await upsertAppSetting(prisma, { actorId: auth.user.id, key: u.key, value: u.value });
      }
    }

    revalidatePath("/admin/settings");
    return undefined;
  });
}

/**
 * XP-карта (spec 12.1/C1): сохраняет полную карту одной записью app_settings
 * (`xp_map`, JSON). Каждое значение — целое 0–10000. Аудит + сброс 60с-кеша —
 * внутри upsertAppSetting. planXp читает её на лету через getXpMap.
 */
export async function updateXpMapAction(input: unknown): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("admin");
    const parsed = parseInput(xpMapSchema, input);
    // Only known keys are persisted; missing keys fall back to the code default.
    const clean: Record<string, number> = {};
    for (const key of XP_MAP_KEYS) {
      const v = parsed.map[key];
      clean[key] = typeof v === "number" ? v : DEFAULT_XP_MAP[key as XpMapKey];
    }
    await upsertAppSetting(prisma, {
      actorId: auth.user.id,
      key: XP_MAP_SETTING_KEY,
      value: clean,
    });
    revalidatePath("/admin/settings");
    return undefined;
  });
}

/**
 * Операционные правила (spec 12.1/C2): окно отмены, лок за страйки, горизонт
 * бронирования, лимит новых SRS, cap заморозок, дефолтное время дайджеста. Каждое
 * значение валидируется по OPS_BOUNDS и апсертится отдельной записью (только
 * изменённые). Сервисы читают их на лету.
 */
export async function updateOperationalSettingsAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return runAction<undefined>(async () => {
    const auth = await requireActionRole("admin");
    const parsed = parseInput(operationalSettingsSchema, input);

    for (const [key, value] of Object.entries(parsed.values)) {
      const bounds = OPS_BOUNDS[key];
      if (!bounds) continue; // ignore unknown keys
      if (value < bounds.min || value > bounds.max) {
        throw new ActionError("validation", `Значение вне диапазона ${bounds.min}–${bounds.max}`);
      }
      await upsertAppSetting(prisma, { actorId: auth.user.id, key, value });
    }
    await upsertAppSetting(prisma, {
      actorId: auth.user.id,
      key: DEFAULT_DIGEST_TIME_KEY,
      value: parsed.digestTime,
    });

    revalidatePath("/admin/settings");
    return undefined;
  });
}
