import type { Metadata } from "next";
import { MonitorSmartphone, Trophy } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { formatDateRu, formatDateTimeRu, pluralRu } from "@/lib/utils/dates";
import { getUserAchievements } from "@/lib/services/achievements";
import { getNotificationMatrix } from "@/lib/services/notifications";
import { logoutAction } from "@/lib/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AchievementIcon } from "@/components/features/achievement-icon";
import { ChangePasswordForm } from "./change-password-form";
import { EmailVerifyForm } from "./email-verify-form";
import { NotificationSettings } from "./notification-settings";
import { RevokeOtherSessionsButton } from "./revoke-others-button";

export const metadata: Metadata = {
  title: "Профиль",
};

// Stage 1 scope: the security part of the profile (spec 17 «профиль-безопасность»).
// Theme, timezone, study days, goal, digest and notification matrix join at
// stages 2/5/9 per plan.
export default async function ProfilePage() {
  const { user, session } = await requireStudentZone();
  const [devices, achievements, notificationMatrix] = await Promise.all([
    prisma.device.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" } }),
    getUserAchievements(prisma, user.id),
    getNotificationMatrix(prisma, user.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[24px] font-semibold">Профиль</h1>

      <Card>
        <CardHeader>
          <CardTitle>Аккаунт</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-[14px]">
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
            <span className="text-text-2">Имя</span>
            <span>{user.name}</span>
          </div>
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
            <span className="text-text-2">Email</span>
            <span className="inline-flex items-center gap-2">
              {user.email}
              {user.emailVerifiedAt ? (
                <Badge variant="success">подтверждён</Badge>
              ) : (
                <Badge variant="warning">не подтверждён</Badge>
              )}
            </span>
          </div>
          {/* Soft email verification (spec 12.1/C8) — code form while unverified. */}
          {!user.emailVerifiedAt && (
            <div className="border-border mt-1 border-t pt-3">
              <p className="text-text-3 mb-2 text-[13px]">
                Введи код из письма, чтобы подтвердить почту. Это не обязательно.
              </p>
              <EmailVerifyForm />
            </div>
          )}
          {user.accessUntil && (
            // Spec 7.1.2: спокойная строка, без таймеров.
            <div className="flex flex-wrap justify-between gap-x-6 gap-y-1">
              <span className="text-text-2">Доступ</span>
              <span>до {formatDateRu(user.accessUntil, user.timezone)}</span>
            </div>
          )}
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

      {/* Уведомления (spec 7.12/8.3): матрица тумблеров, тихие часы, дайджест. */}
      <Card>
        <CardHeader>
          <CardTitle>Уведомления</CardTitle>
          <CardDescription>
            Выбери, о чём напоминать и куда. Важные уведомления (фидбек, отмены, доступ) приходят
            всегда.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettings
            matrix={notificationMatrix}
            digestTime={user.digestTime}
            quietHoursStart={user.quietHoursStart}
            quietHoursEnd={user.quietHoursEnd}
          />
        </CardContent>
      </Card>

      {/* Достижения (spec 8.3): счётчик + список полученных; витрина — V1. */}
      <Card>
        <CardHeader>
          <CardTitle>Достижения</CardTitle>
          <CardDescription>
            {achievements.count}{" "}
            {pluralRu(achievements.count, "достижение", "достижения", "достижений")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {achievements.count === 0 ? (
            <p className="text-text-2 flex items-center gap-2 text-[14px]">
              <Trophy size={16} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
              Пока нет — учись, проходи тесты и повторяй карточки.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {achievements.earned.map((achievement) => (
                <li key={achievement.key} className="flex items-center gap-3">
                  <AchievementIcon name={achievement.icon} />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{achievement.title}</p>
                    <p className="text-text-2 text-[13px]">{achievement.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Устройства</CardTitle>
          <CardDescription>
            Одновременно можно работать с одного устройства, платформа помнит два.
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
                  className="rounded-control border-border flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border px-3 py-2.5"
                >
                  <span className="flex items-center gap-2.5 text-[14px]">
                    <MonitorSmartphone
                      size={16}
                      strokeWidth={1.75}
                      className="text-text-3 shrink-0"
                      aria-hidden="true"
                    />
                    {device.label}
                    {device.id === session.deviceId && (
                      <Badge variant="accent">Это устройство</Badge>
                    )}
                  </span>
                  <span className="text-text-3 text-[13px]">
                    был активен {formatDateTimeRu(device.lastSeenAt, user.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <RevokeOtherSessionsButton />
          </div>
        </CardContent>
      </Card>

      <div>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost">
            Выйти
          </Button>
        </form>
      </div>
    </div>
  );
}
