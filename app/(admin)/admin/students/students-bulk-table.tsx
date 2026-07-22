"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { UserStatus } from "@prisma/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import { UserStatusBadge } from "@/components/features/user-status-badge";
import { useRowSelection, pageCheckState } from "@/lib/hooks/use-row-selection";
import { bulkExtendAccessAction, bulkGiftFreezeAction } from "@/lib/actions/students";

export interface StudentRow {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  accessUntilText: string;
  lastSeenText: string;
}

// C5 (spec 13.1): students register with row checkboxes + bulk extend (+30/+90)
// and gift-freeze. The toolbar is only rendered for students.manage viewers.
export function StudentsBulkTable({
  students,
  canManage,
}: {
  students: StudentRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const selection = useRowSelection();
  const pageIds = students.map((s) => s.id);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; data?: { message: string }; error?: { message: string } } | null>) {
    startTransition(async () => {
      const result = await action();
      if (!result) return;
      if (result.ok) {
        toast({ title: result.data!.message, variant: "success" });
        selection.clear();
        router.refresh();
      } else {
        toast({ title: result.error!.message, variant: "danger" });
      }
    });
  }

  function togglePage(): void {
    const allOn = pageIds.length > 0 && pageIds.every((id) => selection.has(id));
    selection.setMany(pageIds, !allOn);
  }

  const colSpan = canManage ? 6 : 5;

  return (
    <div className="flex flex-col gap-3">
      {canManage && selection.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-text-2 text-[13px]">Выбрано: {selection.size}</span>
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => run(() => bulkExtendAccessAction({ userIds: [...selection.selected], days: 30 }))}
          >
            +30 дней
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => run(() => bulkExtendAccessAction({ userIds: [...selection.selected], days: 90 }))}
          >
            +90 дней
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => run(() => bulkGiftFreezeAction({ userIds: [...selection.selected] }))}
          >
            Подарить заморозку
          </Button>
          <Button variant="ghost" size="sm" onClick={selection.clear}>
            Снять выбор
          </Button>
        </Card>
      )}

      <Card>
        {/* Spec 13: admin tables are desktop-first; on mobile the card scrolls horizontally. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead>
              <tr className="border-border text-text-3 border-b text-left text-[12px] tracking-wide uppercase">
                {canManage && (
                  <th className="w-10 px-5 py-3">
                    <Checkbox
                      checked={pageCheckState(selection, pageIds)}
                      onCheckedChange={togglePage}
                      aria-label="Выбрать всех"
                    />
                  </th>
                )}
                <th className="px-5 py-3 font-medium">Ученик</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Доступ до</th>
                <th className="px-5 py-3 font-medium">Последний визит</th>
                <th className="px-5 py-3 font-medium">Серия</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr
                  key={student.id}
                  className="border-border ease-app hover:bg-surface-2 border-b transition-colors duration-150 last:border-b-0"
                >
                  {canManage && (
                    <td className="px-5 py-3">
                      <Checkbox
                        checked={selection.has(student.id)}
                        onCheckedChange={() => selection.toggle(student.id)}
                        aria-label={`Выбрать ${student.name || student.email}`}
                      />
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <Link href={`/admin/students/${student.id}`} className="group block">
                      <span className="text-text-1 group-hover:text-accent block font-medium">
                        {student.name || "—"}
                      </span>
                      <span className="text-text-3 block text-[13px]">{student.email}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <UserStatusBadge status={student.status} />
                  </td>
                  <td className="text-text-2 px-5 py-3">{student.accessUntilText}</td>
                  <td className="text-text-2 px-5 py-3">{student.lastSeenText}</td>
                  <td className="text-text-3 px-5 py-3">—</td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="text-text-3 px-5 py-6 text-center text-[13px]">
                    Никого не нашлось
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
