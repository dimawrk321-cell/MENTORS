"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { useRowSelection, pageCheckState } from "@/lib/hooks/use-row-selection";
import {
  RecordingFormDialog,
  type RecordingFormValue,
} from "@/components/features/recording-form-dialog";
import { RecordingStatusButton } from "@/components/features/recording-status-button";
import { RecordingDeleteButton } from "@/components/features/recording-delete-button";
import { bulkRecordingStatusAction } from "@/lib/actions/library";

export interface LibRow {
  id: string;
  title: string;
  cardTitle: string;
  status: "draft" | "published";
  complete: boolean;
  checklistCount: number;
  linkUpdatedText: string;
  stale: boolean;
  views: number;
  formValue: RecordingFormValue;
}

// C3 (spec 13.1): library table with row checkboxes + select-all header and a bulk
// publish/draft toolbar. The 4/4 checklist gate stays server-authoritative — bulk
// publish only flips passing drafts and reports the skipped count.
export function LibraryBulkTable({ rows }: { rows: LibRow[] }) {
  const router = useRouter();
  const selection = useRowSelection();
  const pageIds = rows.map((r) => r.id);
  const [pending, startTransition] = useTransition();

  function runBulk(status: "draft" | "published"): void {
    startTransition(async () => {
      const result = await bulkRecordingStatusAction({
        recordingIds: [...selection.selected],
        status,
      });
      if (!result) return;
      if (result.ok) {
        toast({ title: result.data.message, variant: "success" });
        selection.clear();
        router.refresh();
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  function togglePage(): void {
    const allOn = pageIds.length > 0 && pageIds.every((id) => selection.has(id));
    selection.setMany(pageIds, !allOn);
  }

  return (
    <div className="flex flex-col gap-3">
      {selection.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <span className="text-text-2 text-[13px]">Выбрано: {selection.size}</span>
          <Button variant="secondary" size="sm" loading={pending} onClick={() => runBulk("published")}>
            Опубликовать 4/4
          </Button>
          <Button variant="secondary" size="sm" loading={pending} onClick={() => runBulk("draft")}>
            В черновик
          </Button>
          <Button variant="ghost" size="sm" onClick={selection.clear}>
            Снять выбор
          </Button>
        </Card>
      )}

      <div className="rounded-card border-border overflow-x-auto border">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="text-text-3 border-border border-b">
            <tr>
              <th className="w-10 p-3">
                <Checkbox
                  checked={pageCheckState(selection, pageIds)}
                  onCheckedChange={togglePage}
                  aria-label="Выбрать все записи"
                />
              </th>
              <th className="p-3 font-medium">Запись</th>
              <th className="p-3 font-medium">Статус</th>
              <th className="p-3 font-medium">Чеклист</th>
              <th className="p-3 font-medium">Ссылка обновлена</th>
              <th className="p-3 font-medium">Просмотры</th>
              <th className="p-3 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-border border-b align-top last:border-0">
                <td className="p-3">
                  <Checkbox
                    checked={selection.has(r.id)}
                    onCheckedChange={() => selection.toggle(r.id)}
                    aria-label={`Выбрать запись «${r.title}»`}
                  />
                </td>
                <td className="p-3">
                  <div className="text-text-1 font-medium">{r.title}</div>
                  <div className="text-text-3 text-[12px]">{r.cardTitle}</div>
                </td>
                <td className="p-3">
                  {r.status === "published" ? (
                    <Badge variant="success">опубликовано</Badge>
                  ) : (
                    <Badge>черновик</Badge>
                  )}
                </td>
                <td className="p-3">
                  {r.complete ? (
                    <Badge variant="success">4/4</Badge>
                  ) : (
                    <Badge variant="warning">{r.checklistCount}/4</Badge>
                  )}
                </td>
                <td className="p-3">
                  <span className={cn(r.stale && "text-warning")}>
                    {r.linkUpdatedText}
                    {r.stale && " · устарела"}
                  </span>
                </td>
                <td className="p-3 tabular-nums">{r.views}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <RecordingFormDialog recording={r.formValue} />
                    <RecordingStatusButton id={r.id} status={r.status} canPublish={r.complete} />
                    {r.status === "draft" && r.views === 0 && <RecordingDeleteButton id={r.id} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
