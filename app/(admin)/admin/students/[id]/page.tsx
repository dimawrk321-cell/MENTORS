import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MonitorSmartphone } from "lucide-react";
import { prisma } from "@/lib/db";
import { hasRole, requireAdminZone } from "@/lib/auth/guards";
import { getStudentDetail } from "@/lib/services/access";
import { getRecentSentNotifications } from "@/lib/services/notifications";
import {
  getStudentEvents,
  getStudentMockHistory,
  getStudentProgress,
  getStudentReviewSummary,
  getStudentTestAttempts,
} from "@/lib/services/admin-student";
import { daysUntil, formatDateRu, formatDateTimeRu, pluralRu } from "@/lib/utils/dates";
import { StudentTabs } from "./student-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { UserStatusBadge } from "@/components/features/user-status-badge";
import { categoryColorVar } from "@/lib/utils/category-color";
import { ExtendAccessControls } from "./extend-access-controls";
import {
  BlockButton,
  ImpersonateButton,
  LibraryToggle,
  ResendInviteButton,
  ResetSessionsButton,
  UnblockButton,
} from "./student-controls";

export const metadata: Metadata = {
  title: "Карточка ученика",
};

interface StudentPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-[14px]">
      <span className="text-text-2">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

/** Minimal stage-1 student card (spec 8.5): профиль и доступ; вкладки — этап 10. */
export default async function StudentPage({ params, searchParams }: StudentPageProps) {
  const { user: viewer } = await requireAdminZone();
  const { id } = await params;
  const { tab } = await searchParams;
  const detail = await getStudentDetail(prisma, id);
  if (!detail) notFound();

  const { user, sessions, invite } = detail;
  const canManage = hasRole(viewer, "admin");
  const now = new Date();
  // Diagnostic tabs (spec 8.5): progress, tests, reviews, mocks, notifications, events.
  const [notifications, progress, testAttempts, review, mocks, events] = await Promise.all([
    getRecentSentNotifications(prisma, user.id, 30),
    getStudentProgress(prisma, user.id),
    getStudentTestAttempts(prisma, user.id),
    getStudentReviewSummary(prisma, user.id, now),
    getStudentMockHistory(prisma, user.id),
    getStudentEvents(prisma, user.id, 50),
  ]);
  const daysLeft = user.accessUntil ? daysUntil(user.accessUntil, now) : null;

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/admin/students"
        className="text-text-3 ease-app hover:text-text-1 flex w-fit items-center gap-1.5 text-[13px] transition-colors duration-150"
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
        Ученики
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="rounded-pill flex size-11 shrink-0 items-center justify-center text-[16px] font-semibold"
            style={{
              background: `color-mix(in srgb, ${categoryColorVar(user.avatarColor)} 15%, transparent)`,
              color: categoryColorVar(user.avatarColor),
            }}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="flex flex-wrap items-center gap-2.5 text-[24px] font-semibold">
              {user.name}
              <UserStatusBadge status={user.status} />
            </h1>
            <p className="text-text-3 text-[13px]">{user.email}</p>
          </div>
        </div>
        {canManage && user.status !== "invited" && user.status !== "blocked" && (
          <ImpersonateButton userId={user.id} />
        )}
      </div>

      {invite && (
        <Card>
          <CardHeader>
            <CardTitle>Инвайт</CardTitle>
            <CardDescription>
              {invite.expired
                ? "Ссылка истекла — отправь инвайт повторно, чтобы создать новую."
                : `Ссылка действует до ${formatDateRu(invite.expiresAt, viewer.timezone)}. Отправь её ученику любым удобным способом.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!invite.expired && (
              <div className="flex items-center gap-2">
                <Input readOnly defaultValue={invite.url} />
                <CopyButton value={invite.url} />
              </div>
            )}
            {canManage && (
              <div>
                <ResendInviteButton userId={user.id} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Доступ</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          <InfoRow label="Активирован">
            {user.activatedAt ? formatDateRu(user.activatedAt, viewer.timezone) : "ещё нет"}
          </InfoRow>
          <InfoRow label="Доступ до">
            {user.accessUntil ? (
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                {formatDateRu(user.accessUntil, viewer.timezone)}
                {daysLeft !== null &&
                  (daysLeft > 0 ? (
                    <Badge variant={daysLeft <= 14 ? "warning" : "default"}>
                      {daysLeft <= 14
                        ? `осталось ${daysLeft} ${pluralRu(daysLeft, "день", "дня", "дней")}`
                        : `${daysLeft} ${pluralRu(daysLeft, "день", "дня", "дней")}`}
                    </Badge>
                  ) : (
                    <Badge variant="warning">истёк</Badge>
                  ))}
              </span>
            ) : (
              "—"
            )}
          </InfoRow>
          <InfoRow label="Последний визит">
            {user.lastSeenAt ? formatDateTimeRu(user.lastSeenAt, viewer.timezone) : "—"}
          </InfoRow>
          <InfoRow label="Таймзона">{user.timezone}</InfoRow>

          {canManage && user.status !== "invited" && (
            <div className="border-border mt-2 flex flex-wrap items-center gap-2 border-t pt-4">
              <ExtendAccessControls userId={user.id} />
              <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden="true" />
              {user.status === "blocked" ? (
                <UnblockButton userId={user.id} />
              ) : (
                <BlockButton userId={user.id} name={user.name} />
              )}
            </div>
          )}

          {user.accessExtensions.length > 0 && (
            <div className="border-border mt-2 border-t pt-4">
              <h3 className="text-text-2 mb-2 text-[13px] font-medium">История продлений</h3>
              <ul className="flex flex-col gap-1.5">
                {user.accessExtensions.map((ext) => (
                  <li key={ext.id} className="text-text-2 text-[13px]">
                    {formatDateRu(ext.createdAt, viewer.timezone)} · +{ext.days}{" "}
                    {pluralRu(ext.days, "день", "дня", "дней")} → до{" "}
                    {formatDateRu(ext.newAccessUntil, viewer.timezone)} · {ext.grantedBy.name}
                    {ext.comment ? ` — ${ext.comment}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Сессии и устройства</CardTitle>
          <CardDescription>
            Одна одновременная сессия, до двух запомненных устройств.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <h3 className="text-text-2 mb-2 text-[13px] font-medium">Активные сессии</h3>
            {sessions.length === 0 ? (
              <p className="text-text-3 text-[14px]">Сейчас нет активных сессий.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {sessions.map((session) => (
                  <li key={session.id} className="text-text-2 text-[14px]">
                    {session.city ?? session.ip} · активна с{" "}
                    {formatDateTimeRu(session.createdAt, viewer.timezone)} · последняя активность{" "}
                    {formatDateTimeRu(session.lastActiveAt, viewer.timezone)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-text-2 mb-2 text-[13px] font-medium">Устройства</h3>
            {user.devices.length === 0 ? (
              <p className="text-text-3 text-[14px]">Пока нет запомненных устройств.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {user.devices.map((device) => (
                  <li key={device.id} className="text-text-2 flex items-center gap-2 text-[14px]">
                    <MonitorSmartphone
                      size={15}
                      strokeWidth={1.75}
                      className="text-text-3 shrink-0"
                      aria-hidden="true"
                    />
                    {device.label} · был активен{" "}
                    {formatDateTimeRu(device.lastSeenAt, viewer.timezone)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {canManage && (
            <div>
              <ResetSessionsButton userId={user.id} />
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && user.status !== "invited" && (
        <Card>
          <CardHeader>
            <CardTitle>Библиотека записей</CardTitle>
            <CardDescription>
              Тумблер скрывает раздел «Библиотека» и его страницы у этого ученика (spec 7.9).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LibraryToggle userId={user.id} enabled={user.libraryEnabled} />
          </CardContent>
        </Card>
      )}

      {/* Вкладки диагностики (spec 8.5): прогресс/тесты/повторения/моки/уведомления/события. */}
      <div className="pt-2">
        <StudentTabs
          progress={progress}
          testAttempts={testAttempts}
          review={review}
          mocks={mocks}
          notifications={notifications}
          events={events}
          timezone={viewer.timezone}
          defaultTab={tab ?? "progress"}
        />
      </div>
    </div>
  );
}
