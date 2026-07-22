import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MonitorSmartphone } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission, isOwner } from "@/lib/auth/permissions";
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
import { EMAIL_VERIFICATION_UI_ENABLED } from "@/lib/constants";
import { StudentTabs } from "./student-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserStatusBadge } from "@/components/features/user-status-badge";
import { categoryColorVar, categoryTextColor } from "@/lib/utils/category-color";
import { ExtendAccessControls } from "./extend-access-controls";
import {
  BlockButton,
  ImpersonateButton,
  ResetSessionsButton,
  SectionAccessToggle,
  UnblockButton,
} from "./student-controls";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { ChangeEmailDialog } from "./change-email-dialog";

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
  const { user: viewer } = await requirePermission("students.view");
  const { id } = await params;
  const { tab } = await searchParams;
  const detail = await getStudentDetail(prisma, id);
  if (!detail) notFound();

  const { user, sessions } = detail;
  // Walk 12.4/B2: managing access needs `students.manage`.
  const canManage = hasPermission(viewer, "students.manage");
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
              color: categoryTextColor(user.avatarColor),
            }}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="flex flex-wrap items-center gap-2.5 text-[24px] font-semibold">
              {user.name || user.email}
              <UserStatusBadge status={user.status} />
              {/* D1 (spec 13.1): email-verification badge is @dormant. */}
              {EMAIL_VERIFICATION_UI_ENABLED &&
                !user.emailVerifiedAt &&
                (user.status === "active" || user.status === "expired") && (
                  <Badge variant="warning">почта не подтверждена</Badge>
                )}
            </h1>
            <p className="text-text-3 text-[13px]">{user.email}</p>
          </div>
        </div>
        {canManage && user.status !== "invited" && user.status !== "blocked" && (
          <ImpersonateButton userId={user.id} />
        )}
      </div>

      {/* Безопасность (spec 12.1/B2): активные сессии, устройства, сброс — заметной
          секцией над вкладками (было ниже и терялось). */}
      <Card>
        <CardHeader>
          <CardTitle>Безопасность</CardTitle>
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
            <div className="flex flex-wrap gap-2">
              <ResetSessionsButton userId={user.id} />
              {/* Walk 12.4/A2: reset to a temporary password (student with a
                  password, not blocked). Legacy invited students without a
                  password are handled manually. */}
              {user.passwordHash && user.status !== "blocked" && (
                <ResetPasswordDialog userId={user.id} email={user.email} />
              )}
              {/* D2 (spec 13.1): change email is owner-only (a login-identity change). */}
              {isOwner(viewer) && <ChangeEmailDialog userId={user.id} currentEmail={user.email} />}
            </div>
          )}
        </CardContent>
      </Card>

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

      {canManage && user.status !== "invited" && (
        <Card>
          <CardHeader>
            <CardTitle>Доступы к разделам</CardTitle>
            <CardDescription>
              Тумблеры скрывают разделы и их страницы у этого ученика (spec 7.9/7.10/12.1).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SectionAccessToggle
              userId={user.id}
              section="library"
              enabled={user.libraryEnabled}
              label="Библиотека записей"
              onLabel="Библиотека открыта ученику"
              offLabel="Библиотека скрыта у ученика"
            />
            <SectionAccessToggle
              userId={user.id}
              section="resume"
              enabled={user.guidesResumeEnabled}
              label="Раздел «Резюме»"
              onLabel="Раздел «Резюме» открыт ученику"
              offLabel="Раздел «Резюме» скрыт у ученика"
            />
            <SectionAccessToggle
              userId={user.id}
              section="legend"
              enabled={user.guidesLegendEnabled}
              label="Раздел «Легенда»"
              onLabel="Раздел «Легенда» открыт ученику"
              offLabel="Раздел «Легенда» скрыт у ученика"
            />
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
