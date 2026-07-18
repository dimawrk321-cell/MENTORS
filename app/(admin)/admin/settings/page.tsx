import type { Metadata } from "next";
import type { CourseGating } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdminZone } from "@/lib/auth/guards";
import {
  ACCESS_RULES_SETTING_KEY,
  DEFAULT_ACCESS_RULES_TEXT,
  DEFAULT_COURSE_GATING_SETTING_KEY,
  RENEWAL_CONTACT_SETTING_KEY,
} from "@/lib/services/settings";
import { XP_RULES } from "@/lib/services/xp";
import { STREAK_FREEZE_CAP, STREAK_FREEZE_EVERY, STREAK_MILESTONES } from "@/lib/services/streak";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Настройки" };

/** /admin/settings (spec 8.5): editable контакт/правила/гейтинг + read-only XP/стрик. admin+. */
export default async function SettingsPage() {
  await requireAdminZone("admin");

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
  const map = new Map(rows.map((r) => [r.key, r.value as string]));
  const renewalContact = map.get(RENEWAL_CONTACT_SETTING_KEY) ?? "";
  const accessRulesText = map.get(ACCESS_RULES_SETTING_KEY) ?? DEFAULT_ACCESS_RULES_TEXT;
  const gating = (map.get(DEFAULT_COURSE_GATING_SETTING_KEY) as CourseGating) ?? "strict";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[24px] font-semibold">Настройки</h1>
        <p className="text-text-2 mt-1 text-[14px]">
          Меняются без редеплоя · каждое сохранение в аудите
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Платформа</CardTitle>
          {!renewalContact && (
            <CardDescription>
              Контакт продления сейчас берётся из env: {env.renewalContact ?? "не задан"}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <SettingsForm
            renewalContact={renewalContact}
            accessRulesText={accessRulesText}
            defaultCourseGating={gating}
          />
        </CardContent>
      </Card>

      {/* Read-only: XP-карта (spec 7.7) */}
      <Card>
        <CardHeader>
          <CardTitle>XP-карта</CardTitle>
          <CardDescription>Только просмотр — правило живёт код-константой.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-border flex flex-col divide-y">
            {XP_RULES.map((rule) => (
              <li
                key={rule.event}
                className="flex items-center justify-between gap-3 py-2 text-[14px]"
              >
                <span>{rule.event}</span>
                <span className="text-text-2 shrink-0 tabular-nums">
                  {rule.amount} <span className="text-text-3">· {rule.rule}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Read-only: правила стрика (spec 7.7) */}
      <Card>
        <CardHeader>
          <CardTitle>Правила серии</CardTitle>
          <CardDescription>Только просмотр.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-text-2 flex flex-col gap-1.5 text-[14px]">
            <li>День засчитан, если в учебный день было хотя бы одно качественное действие.</li>
            <li>
              Заморозка: +1 за каждые {STREAK_FREEZE_EVERY} подряд засчитанных дней, максимум{" "}
              {STREAK_FREEZE_CAP}.
            </li>
            <li>Вехи серии: {STREAK_MILESTONES.join(" / ")} дней.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
