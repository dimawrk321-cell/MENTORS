import type { Metadata } from "next";
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
import { IssueCredentialsDialog } from "./issue-credentials-dialog";
import { StudentsBulkTable } from "./students-bulk-table";

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
        <StudentsBulkTable
          canManage={canManage}
          students={students.map((s) => ({
            id: s.id,
            name: s.name,
            email: s.email,
            status: s.status,
            accessUntilText: s.accessUntil ? formatDateRu(s.accessUntil, viewer.timezone) : "—",
            lastSeenText: s.lastSeenAt ? formatDateTimeRu(s.lastSeenAt, viewer.timezone) : "—",
          }))}
        />
      )}
    </div>
  );
}
