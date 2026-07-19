"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { updateNotificationSettingsAction } from "@/lib/actions/profile";
import type { MatrixRow } from "@/lib/services/notifications";

// Notification settings (spec 7.12/8.3): toggleable type×channel matrix, quiet
// hours, digest time. «Всегда»-типы don't appear here (only toggleable channels
// are rendered). digest_time is the same field the onboarding «Напоминания» step
// sets — editing it here updates that single setting.

const timeField =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-11 border bg-transparent px-3 text-[14px] transition-colors duration-150 md:h-9";

interface Props {
  matrix: MatrixRow[];
  digestTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}

type PrefState = Record<string, { inapp: boolean; email: boolean }>;

export function NotificationSettings({ matrix, ...initial }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [digestTime, setDigestTime] = useState(initial.digestTime);
  const [quietStart, setQuietStart] = useState(initial.quietHoursStart);
  const [quietEnd, setQuietEnd] = useState(initial.quietHoursEnd);
  const [prefs, setPrefs] = useState<PrefState>(() =>
    Object.fromEntries(
      matrix.map((row) => [row.type, { inapp: row.inapp.value, email: row.email.value }]),
    ),
  );

  const setChannel = (type: string, channel: "inapp" | "email", value: boolean) => {
    setPrefs((prev) => ({ ...prev, [type]: { ...prev[type]!, [channel]: value } }));
  };

  const save = () => {
    start(async () => {
      const res = await updateNotificationSettingsAction({
        digestTime,
        quietHoursStart: quietStart,
        quietHoursEnd: quietEnd,
        prefs,
      });
      if (res.ok) {
        toast({ title: "Настройки сохранены", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

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
          <span className="text-text-2 text-[13px]">Тихие часы (письма откладываются)</span>
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
              <div className="flex items-center gap-6">
                <div className="flex w-24 items-center justify-between gap-2 sm:justify-center">
                  <span className="text-text-2 text-[12px] sm:hidden">В приложении</span>
                  {row.inapp.shown ? (
                    <Switch
                      aria-label={`${row.label}: в приложении`}
                      checked={prefs[row.type]!.inapp}
                      onCheckedChange={(v) => setChannel(row.type, "inapp", v)}
                    />
                  ) : (
                    <span className="text-text-3 text-[13px]">—</span>
                  )}
                </div>
                <div className="flex w-24 items-center justify-between gap-2 sm:justify-center">
                  <span className="text-text-2 text-[12px] sm:hidden">Почта</span>
                  {row.email.shown ? (
                    <Switch
                      aria-label={`${row.label}: почта`}
                      checked={prefs[row.type]!.email}
                      onCheckedChange={(v) => setChannel(row.type, "email", v)}
                    />
                  ) : (
                    <span className="text-text-3 text-[13px]">—</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <Button onClick={save} loading={pending}>
          Сохранить настройки
        </Button>
      </div>
    </div>
  );
}
