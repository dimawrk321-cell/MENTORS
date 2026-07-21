import type { Metadata } from "next";
import Link from "next/link";
import { Search, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/permissions";
import { listStudents } from "@/lib/services/access";
import { formatDateRu, formatDateTimeRu } from "@/lib/utils/dates";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { UserStatusBadge } from "@/components/features/user-status-badge";
import { IssueCredentialsDialog } from "./issue-credentials-dialog";

export const metadata: Metadata = {
  title: "Ученики",
};

interface StudentsPageProps {
  searchParams: Promise<{ q?: string }>;
}

/** Minimal stage-1 register (spec 8.5): search, status, access, last visit + invite flow. */
export default async function StudentsPage({ searchParams }: StudentsPageProps) {
  const { user: viewer } = await requirePermission("students.view");
  const { q } = await searchParams;
  const query = q?.trim() || undefined;
  const students = await listStudents(prisma, query);
  // Walk 12.4/B2: issuing/managing access needs `students.manage`; students.view
  // alone is read-only.
  const canManage = hasPermission(viewer, "students.manage");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold">Ученики</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <IssueCredentialsDialog />}
        </div>
      </div>

      <form className="flex max-w-md gap-2" role="search">
        <Input
          type="search"
          name="q"
          defaultValue={query ?? ""}
          placeholder="Поиск по имени или email"
          aria-label="Поиск по имени или email"
        />
        <Button type="submit" variant="secondary">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          Найти
        </Button>
      </form>

      {students.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={query ? "Никого не нашлось" : "Пока нет учеников"}
            description={
              query
                ? "Попробуй изменить запрос"
                : canManage
                  ? "Выдай доступ первому ученику — кнопка выше"
                  : "Доступ выдаёт админ"
            }
          />
        </Card>
      ) : (
        <Card>
          {/* Spec 13: admin tables are desktop-first; on mobile the card scrolls horizontally. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead>
                <tr className="border-border text-text-3 border-b text-left text-[12px] tracking-wide uppercase">
                  <th className="px-5 py-3 font-medium">Ученик</th>
                  <th className="px-5 py-3 font-medium">Статус</th>
                  <th className="px-5 py-3 font-medium">Доступ до</th>
                  <th className="px-5 py-3 font-medium">Последний визит</th>
                  {/* Стрик появится на этапе 5 — колонка по spec 8.5 с заглушкой. */}
                  <th className="px-5 py-3 font-medium">Серия</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr
                    key={student.id}
                    className="border-border ease-app hover:bg-surface-2 border-b transition-colors duration-150 last:border-b-0"
                  >
                    <td className="px-5 py-3">
                      <Link href={`/admin/students/${student.id}`} className="group block">
                        <span className="text-text-1 group-hover:text-accent block font-medium">
                          {student.name}
                        </span>
                        <span className="text-text-3 block text-[13px]">{student.email}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <UserStatusBadge status={student.status} />
                        {/* Soft email verification (spec 12.1/C8) — activated but unverified. */}
                        {!student.emailVerifiedAt &&
                          (student.status === "active" || student.status === "expired") && (
                            <Badge variant="warning">почта не подтверждена</Badge>
                          )}
                      </div>
                    </td>
                    <td className="text-text-2 px-5 py-3">
                      {student.accessUntil
                        ? formatDateRu(student.accessUntil, viewer.timezone)
                        : "—"}
                    </td>
                    <td className="text-text-2 px-5 py-3">
                      {student.lastSeenAt
                        ? formatDateTimeRu(student.lastSeenAt, viewer.timezone)
                        : "—"}
                    </td>
                    <td className="text-text-3 px-5 py-3">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
