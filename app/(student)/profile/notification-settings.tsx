"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { updateNotificationSettingsAction } from "@/lib/actions/profile";
import type { MatrixRow } from "@/lib/services/notifications";
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";

// Notification settings (spec 7.12/8.3): toggleable type×channel matrix, quiet
// hours, digest time. «Всегда»-типы don't appear here (only toggleable channels
// are rendered). digest_time is the same field the onboarding «Напоминания» step
// sets — editing it here updates that single setting. The Telegram column renders
// only when the user has linked Telegram (spec 13.3: «рендерится только подключившим»).

const timeField =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-11 border bg-transparent px-3 text-[14px] transition-colors duration-150 md:h-9";

interface Props {
  matrix: MatrixRow[];
  digestTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  telegramLinked: boolean;
}

type Channel = "inapp" | "email" | "telegram";
type PrefState = Record<string, { inapp: boolean; email: boolean; telegram: boolean }>;

export function NotificationSettings({ matrix, telegramLinked, ...initial }: Props) {
  const router = useRouter();
  // «Глазами ученика»: настройки чужие (spec 7.2) — показываем как есть, но
  // закрываем на входе, чтобы ментор не перещёлкивал матрицу впустую.
  const viewOnly = useViewOnly();
  const [pending, start] = useTransition();
  const [digestTime, setDigestTime] = useState(initial.digestTime);
  const [quietStart, setQuietStart] = useState(initial.quietHoursStart);
  const [quietEnd, setQuietEnd] = useState(initial.quietHoursEnd);
  const [prefs, setPrefs] = useState<PrefState>(() =>
    Object.fromEntries(
      matrix.map((row) => [
        row.type,
        { inapp: row.inapp.value, email: row.email.value, telegram: row.telegram.value },
      ]),
    ),
  );

  const setChannel = (type: string, channel: Channel, value: boolean) => {
    setPrefs((prev) => ({ ...prev, [type]: { ...prev[type]!, [channel]: value } }));
  };

  const save = () => {
    start(async () => {
      // Only submit telegram when linked — the hidden column must not clamp the
      // stored override (updateNotificationPrefs keeps an absent channel).
      const payload = Object.fromEntries(
        matrix.map((row) => {
          const p = prefs[row.type]!;
          return [
            row.type,
            telegramLinked
              ? { inapp: p.inapp, email: p.email, telegram: p.telegram }
              : { inapp: p.inapp, email: p.email },
          ];
        }),
      );
      const res = await updateNotificationSettingsAction({
        digestTime,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        prefs: payload,
      });
      if (res.ok) {
        toast({ title: "Настройки сохранены", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

  const cell = (row: MatrixRow, channel: Channel, mobileLabel: string) => (
    <div className="flex w-full items-center justify-between gap-2 sm:w-24 sm:justify-center">
      <span className="text-text-2 text-[12px] sm:hidden">{mobileLabel}</span>
      {row[channel].shown ? (
        <Switch
          aria-label={`${row.label}: ${mobileLabel}`}
          checked={prefs[row.type]![channel]}
          onCheckedChange={(v) => setChannel(row.type, channel, v)}
          disabled={viewOnly}
        />
      ) : (
        <span className="text-text-3 text-[13px]">—</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Timing */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-text-2 text-[13px]">Время дайджеста</span>
          <input
            type="time"
            value={digestTime}
            onChange={(e) => setDigestTime(e.target.value)}
            className={timeField}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-text-2 text-[13px]">Тихие часы (пуши откладываются)</span>
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label="Начало тихих часов"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              className={`${timeField} flex-1`}
            />
            <span className="text-text-3 text-[13px]">—</span>
            <input
              type="time"
              aria-label="Конец тихих часов"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              className={`${timeField} flex-1`}
            />
          </div>
        </div>
      </div>

      {/* Matrix */}
      <div className="flex flex-col">
        <div className="text-text-3 hidden items-center gap-6 px-1 pb-2 text-[12px] sm:flex sm:justify-end">
          <span className="w-24 text-center">В приложении</span>
          <span className="w-24 text-center">Почта</span>
          {telegramLinked && <span className="w-24 text-center">Telegram</span>}
        </div>
        <ul className="divide-border divide-y">
          {matrix.map((row) => (
            <li
              key={row.type}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{row.label}</p>
                <p className="text-text-3 text-[12px]">{row.description}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
                {cell(row, "inapp", "В приложении")}
                {cell(row, "email", "Почта")}
                {telegramLinked && cell(row, "telegram", "Telegram")}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {viewOnly && <ViewOnlyNote>Режим просмотра: настройки ученика не меняются.</ViewOnlyNote>}
      <div>
        <Button
          onClick={save}
          loading={pending}
          disabled={viewOnly}
          title={viewOnly ? VIEW_ONLY_TITLE : undefined}
        >
          Сохранить настройки
        </Button>
      </div>
    </div>
  );
}
