import type { Metadata } from "next";
import Link from "next/link";
import type { SecurityFlagType } from "@prisma/client";
import { ShieldAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import {
  listActiveStudentSessions,
  listMultiDeviceStudents,
  listOpenSecurityFlags,
  listRecentPasswordResets,
} from "@/lib/services/admin-security";
import { formatDateTimeRu } from "@/lib/utils/dates";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ResolveFlagButton, TerminateSessionButton } from "./security-actions";

export const metadata: Metadata = {
  title: "Безопасность",
};

const SESSIONS_PAGE_SIZE = 30;

const FLAG_LABEL: Record<SecurityFlagType, string> = {
  concurrent_geo: "Вход из разных городов",
  rapid_content: "Слишком быстрый контент",
  manual: "Ручной флаг",
};

function StudentLink({ id, name, email }: { id: string; name: string; email: string }) {
  return (
    <Link href={`/admin/students/${id}`} className="group block">
      <span className="text-text-1 group-hover:text-accent block font-medium">{name || email}</span>
      <span className="text-text-3 block text-[12px]">{email}</span>
    </Link>
  );
}

interface SecurityPageProps {
  searchParams: Promise<{ page?: string }>;
}

/** /admin/security (spec 13.1/D3): platform-wide sessions, device churn, flags, resets. */
export default async function SecurityPage({ searchParams }: SecurityPageProps) {
  const { user: viewer } = await requirePermission("students.manage");
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const now = new Date();
  const tz = viewer.timezone;

  const [sessions, multiDevice, flags, resets] = await Promise.all([
    listActiveStudentSessions(prisma, {
      now,
      skip: (page - 1) * SESSIONS_PAGE_SIZE,
      take: SESSIONS_PAGE_SIZE,
    }),
    listMultiDeviceStudents(prisma, { now }),
    listOpenSecurityFlags(prisma),
    listRecentPasswordResets(prisma, { now }),
  ]);
  const totalPages = Math.max(1, Math.ceil(sessions.total / SESSIONS_PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] font-semibold">Безопасность</h1>
        <p className="text-text-3 text-[13px]">
          Активные сессии учеников, устройства, флаги и сбросы паролей.
        </p>
      </div>

      {/* Открытые security-флаги */}
      <Card>
        <CardHeader>
          <CardTitle>Security-флаги</CardTitle>
          <CardDescription>Открытые флаги антишаринга — разбери и закрой.</CardDescription>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <p className="text-text-3 text-[14px]">Открытых флагов нет.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {flags.map((flag) => (
                <li key={flag.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <StudentLink
                      id={flag.studentId}
                      name={flag.studentName}
                      email={flag.studentEmail}
                    />
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="warning">{FLAG_LABEL[flag.type]}</Badge>
                      <span className="text-text-3 text-[12px]">
                        {formatDateTimeRu(flag.createdAt, tz)}
                      </span>
                    </div>
                  </div>
                  <ResolveFlagButton flagId={flag.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Несколько устройств за 7 дней */}
      <Card>
        <CardHeader>
          <CardTitle>Несколько устройств за 7 дней</CardTitle>
          <CardDescription>Новое устройство при уже занятых слотах — возможный шаринг.</CardDescription>
        </CardHeader>
        <CardContent>
          {multiDevice.length === 0 ? (
            <p className="text-text-3 text-[14px]">Подозрительной смены устройств нет.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {multiDevice.map((row) => (
                <li key={row.studentId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <StudentLink id={row.studentId} name={row.studentName} email={row.studentEmail} />
                  <div className="text-text-2 flex flex-col gap-0.5 text-right text-[12px]">
                    {row.devices.map((d, i) => (
                      <span key={i}>
                        {d.label} · {formatDateTimeRu(d.firstSeenAt, tz)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Сбросы паролей за 30 дней */}
      <Card>
        <CardHeader>
          <CardTitle>Сбросы паролей за 30 дней</CardTitle>
          <CardDescription>«Забыл пароль» учеником и админский сброс на временный.</CardDescription>
        </CardHeader>
        <CardContent>
          {resets.length === 0 ? (
            <p className="text-text-3 text-[14px]">За 30 дней сбросов не было.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {resets.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <span className="text-text-1 block truncate text-[14px] font-medium">
                      {r.studentName || r.studentEmail}
                    </span>
                    <span className="text-text-3 block text-[12px]">{r.studentEmail}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge>{r.kind === "admin" ? "админский" : "самостоятельный"}</Badge>
                    <span className="text-text-3 text-[12px]">{formatDateTimeRu(r.at, tz)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Активные сессии всех учеников */}
      <Card>
        <CardHeader>
          <CardTitle>Активные сессии учеников</CardTitle>
          <CardDescription>Всего активных: {sessions.total}.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.rows.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="Активных сессий нет"
              description="Сейчас никто из учеников не в системе."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="text-text-3 border-border border-b">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Ученик</th>
                    <th className="px-3 py-2 font-medium">Город / IP</th>
                    <th className="px-3 py-2 font-medium">Устройство</th>
                    <th className="px-3 py-2 font-medium">Последняя активность</th>
                    <th className="px-3 py-2 font-medium" aria-label="Действие" />
                  </tr>
                </thead>
                <tbody>
                  {sessions.rows.map((s) => (
                    <tr key={s.id} className="border-border border-b align-top last:border-0">
                      <td className="py-2.5 pr-3">
                        <StudentLink id={s.studentId} name={s.studentName} email={s.studentEmail} />
                      </td>
                      <td className="text-text-2 px-3 py-2.5">{s.location}</td>
                      <td className="text-text-2 px-3 py-2.5">{s.deviceLabel ?? "—"}</td>
                      <td className="text-text-2 px-3 py-2.5">
                        {formatDateTimeRu(s.lastActiveAt, tz)}
                      </td>
                      <td className="px-3 py-2.5">
                        <TerminateSessionButton sessionId={s.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-4 text-[13px]">
              {page > 1 ? (
                <Link href={`/admin/security?page=${page - 1}`} className="text-text-2 hover:text-text-1">
                  ← Назад
                </Link>
              ) : (
                <span className="text-text-3/50">← Назад</span>
              )}
              <span className="text-text-3">
                {page} из {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={`/admin/security?page=${page + 1}`} className="text-text-2 hover:text-text-1">
                  Дальше →
                </Link>
              ) : (
                <span className="text-text-3/50">Дальше →</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
