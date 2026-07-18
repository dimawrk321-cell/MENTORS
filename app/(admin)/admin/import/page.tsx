import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAdminZone } from "@/lib/auth/guards";
import { formatDateTimeRu } from "@/lib/utils/dates";
import {
  IMPORT_COUNT_ORDER,
  IMPORT_RUN_ACTIVE_STATUSES,
  IMPORT_RUN_STATUS_LABEL,
} from "@/lib/constants";
import { IMPORT_STALE_MINUTES } from "@/lib/services/notion-import/admin-import";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { History } from "lucide-react";
import {
  listImportRuns,
  type ImportRunCounts,
  type ImportRunListItem,
} from "@/lib/services/notion-import/admin-import";
import { ImportRunner } from "./import-runner";

export const metadata: Metadata = { title: "Импорт" };

/** /admin/import (spec 7.14 / 8.5): upload → dry-run/import → report + history. admin+. */
export default async function ImportPage() {
  const { user } = await requireAdminZone("admin");
  const runs = await listImportRuns(prisma, 20);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[24px] font-semibold">Импорт</h1>
        <p className="text-text-2 mt-1 text-[14px]">
          Загрузка markdown-экспорта Notion · та же логика, что у CLI · всё создаётся черновиками
        </p>
      </div>

      <ImportRunner />

      <Card>
        <CardHeader>
          <CardTitle>Последние запуски</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <EmptyState
              icon={History}
              title="Импортов ещё не было"
              description="Первый запуск появится здесь."
            />
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {runs.map((run) => (
                <ImportRunRow key={run.id} run={run} timezone={user.timezone} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function totalCreated(counts: ImportRunCounts | null): number {
  if (!counts) return 0;
  const result = counts.result as unknown as Record<string, { created: number; skipped: number }>;
  return IMPORT_COUNT_ORDER.reduce((sum, key) => sum + (result[key]?.created ?? 0), 0);
}

function totalSkipped(counts: ImportRunCounts | null): number {
  if (!counts) return 0;
  const result = counts.result as unknown as Record<string, { created: number; skipped: number }>;
  return IMPORT_COUNT_ORDER.reduce((sum, key) => sum + (result[key]?.skipped ?? 0), 0);
}

function ImportRunRow({ run, timezone }: { run: ImportRunListItem; timezone: string }) {
  // A run left in an active status past the stale window means the process died
  // mid-run (its own catch never ran) — show it honestly. The row is persisted as
  // error the next time an import starts (markStaleActiveRunsFailed).
  const isStuck =
    (IMPORT_RUN_ACTIVE_STATUSES as readonly string[]).includes(run.status) &&
    Date.now() - run.startedAt.getTime() > IMPORT_STALE_MINUTES * 60_000;

  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={run.dryRun ? "default" : "accent"}>
            {run.dryRun ? "Dry-run" : "Импорт"}
          </Badge>
          <span className="truncate text-[14px] font-medium">{run.fileName}</span>
        </div>
        <div className="text-text-3 flex shrink-0 items-center gap-3 text-[12px]">
          <span>{run.actorName}</span>
          <span>{formatDateTimeRu(run.startedAt, timezone)}</span>
        </div>
      </div>

      <div className="text-text-2 text-[13px]">
        {run.status === "done" ? (
          <>
            создано {totalCreated(run.counts)} · пропущено {totalSkipped(run.counts)} · аномалий{" "}
            {run.anomaliesCount}
          </>
        ) : run.status === "error" ? (
          <span className="text-danger">
            {IMPORT_RUN_STATUS_LABEL.error}: {run.error ?? "неизвестно"}
          </span>
        ) : isStuck ? (
          <span className="text-danger">Прервано — процесс остановился (запусти заново)</span>
        ) : (
          <span>{IMPORT_RUN_STATUS_LABEL[run.status] ?? run.status}…</span>
        )}
      </div>

      {run.report && (
        <details className="mt-1 text-[13px]">
          <summary className="text-text-3 hover:text-text-1 cursor-pointer text-[12px] select-none">
            Отчёт
          </summary>
          <pre className="border-border bg-surface-2 rounded-card mt-2 max-h-80 overflow-auto border p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
            {run.report}
          </pre>
        </details>
      )}
    </li>
  );
}
