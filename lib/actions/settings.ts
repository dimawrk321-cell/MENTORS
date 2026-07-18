"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  ACCESS_RULES_SETTING_KEY,
  DEFAULT_COURSE_GATING_SETTING_KEY,
  RENEWAL_CONTACT_SETTING_KEY,
  upsertAppSetting,
} from "@/lib/services/settings";
import {
  parseInput,
  requireActionRole,
  runAction,
  type ActionResult,
} from "@/lib/auth/action-helpers";
import { updateSettingsSchema } from "@/lib/utils/validation";

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
