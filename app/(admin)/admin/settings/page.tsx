import type { Metadata } from "next";
import type { CourseGating } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { requirePermission } from "@/lib/auth/guards";
import {
  ACCESS_RULES_SETTING_KEY,
  DEFAULT_ACCESS_RULES_TEXT,
  DEFAULT_COURSE_GATING_SETTING_KEY,
  OPS_BOOKING_HORIZON_DAYS_KEY,
  OPS_BOUNDS,
  OPS_CANCEL_FREE_HOURS_KEY,
  OPS_NEW_CARDS_PER_DAY_KEY,
  OPS_STREAK_FREEZE_CAP_KEY,
  OPS_STRIKE_LOCK_DAYS_KEY,
  RENEWAL_CONTACT_SETTING_KEY,
  getDefaultDigestTime,
  getLevelTitles,
  getNumericSetting,
  getXpMap,
} from "@/lib/services/settings";
import { serializeLevelTitles } from "@/lib/services/level-titles";
import { DEFAULT_XP_MAP, XP_MAP_KEYS, XP_MAP_LABEL } from "@/lib/services/xp";
import { STREAK_FREEZE_CAP, STREAK_FREEZE_EVERY, STREAK_MILESTONES } from "@/lib/services/streak";
import { SRS_NEW_PER_DAY } from "@/lib/services/srs";
import { CANCEL_FREE_HOURS, SLOT_HORIZON_DAYS, STRIKE_LOCK_DAYS } from "@/lib/constants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "./settings-form";
import { LevelTitlesForm, OperationalSettingsForm, XpMapForm } from "./settings-editors";

export const metadata: Metadata = { title: "Настройки" };

const OPS_META: { key: string; label: string; unit: string; default: number }[] = [
  {
    key: OPS_CANCEL_FREE_HOURS_KEY,
    label: "Окно бесплатной отмены брони",
    unit: "часов",
    default: CANCEL_FREE_HOURS,
  },
  {
    key: OPS_STRIKE_LOCK_DAYS_KEY,
    label: "Длительность лока за страйки",
    unit: "дней",
    default: STRIKE_LOCK_DAYS,
  },
  {
    key: OPS_BOOKING_HORIZON_DAYS_KEY,
    label: "Горизонт бронирования",
    unit: "дней",
    default: SLOT_HORIZON_DAYS,
  },
  {
    key: OPS_NEW_CARDS_PER_DAY_KEY,
    label: "Лимит новых SRS-карточек в день",
    unit: "карточек",
    default: SRS_NEW_PER_DAY,
  },
  {
    key: OPS_STREAK_FREEZE_CAP_KEY,
    label: "Cap заморозок стрика",
    unit: "шт.",
    default: STREAK_FREEZE_CAP,
  },
];

/** /admin/settings (spec 8.5, 12.1/C1-C2): editable контакт/правила/гейтинг + XP-карта + операционные правила. admin+. */
export default async function SettingsPage() {
  await requirePermission("settings.manage");

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

  const xpMap = await getXpMap(prisma);
  const xpItems = XP_MAP_KEYS.map((key) => ({
    key,
    label: XP_MAP_LABEL[key],
    value: xpMap[key],
    default: DEFAULT_XP_MAP[key],
  }));

  const opsItems = await Promise.all(
    OPS_META.map(async (m) => {
      const bounds = OPS_BOUNDS[m.key]!;
      const value = await getNumericSetting(prisma, m.key, m.default, bounds);
      return { ...m, value, min: bounds.min, max: bounds.max };
    }),
  );
  const digestValue = await getDefaultDigestTime(prisma);
  const levelTitlesText = serializeLevelTitles(await getLevelTitles(prisma));

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

      {/* XP-карта (spec 12.1/C1) — редактируемая */}
      <Card>
        <CardHeader>
          <CardTitle>XP-карта</CardTitle>
          <CardDescription>
            Значения XP за события (целое 0–10000). Применяются сервисами на лету.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <XpMapForm items={xpItems} />
        </CardContent>
      </Card>

      {/* Операционные правила (spec 12.1/C2) — редактируемые */}
      <Card>
        <CardHeader>
          <CardTitle>Операционные правила</CardTitle>
          <CardDescription>
            Брони, страйки, SRS, стрик и дайджест. Читаются сервисами на лету.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OperationalSettingsForm
            items={opsItems}
            digest={{ value: digestValue, default: "09:00" }}
          />
        </CardContent>
      </Card>

      {/* Титулы уровней (spec 13.1/D7) — редактируемая линейка */}
      <Card>
        <CardHeader>
          <CardTitle>Титулы уровней</CardTitle>
          <CardDescription>
            Показываются в шапке дашборда и профиле. Бонус-вехи 5/10/15/20 дают +1 заморозку.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LevelTitlesForm initialText={levelTitlesText} />
        </CardContent>
      </Card>

      {/* Read-only: правила стрика (spec 7.7) */}
      <Card>
        <CardHeader>
          <CardTitle>Правила серии</CardTitle>
          <CardDescription>Только просмотр (cap заморозок — в правилах выше).</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-text-2 flex flex-col gap-1.5 text-[14px]">
            <li>День засчитан, если в учебный день было хотя бы одно качественное действие.</li>
            <li>Заморозка: +1 за каждые {STREAK_FREEZE_EVERY} подряд засчитанных дней.</li>
            <li>Вехи серии: {STREAK_MILESTONES.join(" / ")} дней.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
