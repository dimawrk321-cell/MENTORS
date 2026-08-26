import { MonitorSmartphone, Send } from "lucide-react";
import type { Device, Theme } from "@prisma/client";
import { logoutAction } from "@/lib/actions/auth";
import { formatDateRu, formatDateTimeRu } from "@/lib/utils/dates";
import type { MatrixRow } from "@/lib/services/notifications";
import { TELEGRAM_COMMANDS } from "@/lib/services/telegram/commands";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggleTile } from "@/components/features/theme-toggle";
import { TelegramSection } from "@/components/features/telegram-section";
import { ChangePasswordForm } from "./change-password-form";
import { NameForm } from "./name-form";
import { NotificationSettings } from "./notification-settings";
import { RevokeOtherSessionsButton } from "./revoke-others-button";

export function SettingsTab({
  user,
  devices,
  currentDeviceId,
  notificationMatrix,
  telegramLinked,
}: {
  user: {
    name: string;
    email: string;
    accessUntil: Date | null;
    timezone: string;
    theme: Theme;
    digestTime: string;
    quietHoursStart: string;
    quietHoursEnd: string;
  };
  devices: Device[];
  currentDeviceId: string | null;
  notificationMatrix: MatrixRow[];
  telegramLinked: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Аккаунт</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-[14px]">
          <div className="grid gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
            <span className="text-text-2">Имя</span>
            <NameForm initialName={user.name} />
          </div>
          <InfoRow label="Email">
            <span className="break-all">{user.email}</span>
          </InfoRow>
          {user.accessUntil && (
            <InfoRow label="Доступ к платформе">
              до {formatDateRu(user.accessUntil, user.timezone)}
            </InfoRow>
          )}
          <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
            <span className="text-text-2">Тема интерфейса</span>
            <div className="max-w-[220px]">
              <ThemeToggleTile initialTheme={user.theme} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Смена пароля</CardTitle>
          <CardDescription>После смены пароля другие сессии будут завершены.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="bg-accent/12 text-accent flex size-10 shrink-0 items-center justify-center rounded-full">
              <Send size={18} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div>
              <CardTitle>Telegram-бот</CardTitle>
              <CardDescription>
                Напоминания о моках, дайджест и быстрый просмотр прогресса. Учёба остаётся на
                платформе.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TelegramSection linked={telegramLinked} />
          <div className="border-border border-t pt-4">
            <p className="text-text-3 mb-2 text-[12px] font-semibold tracking-[0.06em] uppercase">
              Что умеет бот
            </p>
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {TELEGRAM_COMMANDS.map((command) => (
                <li key={command.cmd} className="flex items-baseline gap-2 text-[13px]">
                  <code className="text-accent font-mono">{command.cmd}</code>
                  <span className="text-text-2">{command.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Уведомления</CardTitle>
          <CardDescription>
            Выбери, о чём напоминать и куда. Важные уведомления приходят всегда.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings
            matrix={notificationMatrix}
            digestTime={user.digestTime}
            quietHoursStart={user.quietHoursStart}
            quietHoursEnd={user.quietHoursEnd}
            telegramLinked={telegramLinked}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Устройства</CardTitle>
          <CardDescription>
            Работать можно с одного устройства, платформа помнит два.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {devices.length === 0 ? (
            <p className="text-text-2 text-[14px]">Пока нет запомненных устройств.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b py-2.5 last:border-b-0"
                >
                  <span className="flex items-center gap-2.5 text-[14px]">
                    <MonitorSmartphone
                      size={16}
                      strokeWidth={1.75}
                      className="text-text-3"
                      aria-hidden="true"
                    />
                    {device.label}
                    {device.id === currentDeviceId && (
                      <Badge variant="accent">это устройство</Badge>
                    )}
                  </span>
                  <span className="text-text-3 text-[13px]">
                    активно {formatDateTimeRu(device.lastSeenAt, user.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <RevokeOtherSessionsButton />
            <form action={logoutAction}>
              <Button type="submit" variant="ghost">
                Выйти из аккаунта
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)]">
      <span className="text-text-2">{label}</span>
      <span>{children}</span>
    </div>
  );
}
