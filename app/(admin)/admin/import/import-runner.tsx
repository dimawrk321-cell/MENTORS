"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toast";
import {
  IMPORT_ANOMALY_LABEL,
  IMPORT_COUNT_LABEL,
  IMPORT_COUNT_ORDER,
  IMPORT_MAX_MD_MB,
  IMPORT_MAX_ZIP_MB,
  IMPORT_RUN_ACTIVE_STATUSES,
  IMPORT_RUN_STATUS_LABEL,
} from "@/lib/constants";
import type { ImportRunCounts } from "@/lib/services/notion-import/admin-import";

// /admin/import client (spec 7.14 / 8.5): upload the export, run dry-run or a
// real import, watch the phase progress (polls the run status), then read the
// CLI-structured report and download it. All import logic lives server-side; this
// only drives the form and renders results.

interface ClientRun {
  id: string;
  fileName: string;
  dryRun: boolean;
  status: string;
  anomaliesCount: number;
  counts: ImportRunCounts | null;
  report: string | null;
  error: string | null;
}

const PHASE_PROGRESS: Record<string, number> = {
  pending: 8,
  parsing: 30,
  planning: 55,
  committing: 82,
  done: 100,
  error: 100,
};

const ACTIVE: ReadonlySet<string> = new Set(IMPORT_RUN_ACTIVE_STATUSES);

export function ImportRunner() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<ClientRun | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [zipName, setZipName] = useState<string>("");

  const active = run !== null && ACTIVE.has(run.status);
  const busy = pending || active;

  // Poll the run status until it reaches a terminal state (spec 7.14).
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/import/${runId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("status");
        const data = (await res.json()) as { run: ClientRun };
        if (cancelled) return;
        setRun(data.run);
        if (ACTIVE.has(data.run.status)) {
          timer = setTimeout(poll, 1000);
        } else {
          if (data.run.status === "done") {
            toast({
              title: data.run.dryRun ? "Dry-run завершён" : "Импорт завершён",
              variant: "success",
            });
            router.refresh(); // refresh the history list + any new drafts
          } else if (data.run.status === "error") {
            toast({ title: data.run.error ?? "Импорт не удался", variant: "danger" });
          }
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId, router]);

  const submit = (dryRun: boolean) => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast({ title: "Прикрепи файл экспорта (.md)", variant: "danger" });
      return;
    }
    if (
      !dryRun &&
      !window.confirm("Запустить импорт с записью в базу? Всё создаётся черновиками.")
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    const zip = zipRef.current?.files?.[0];
    if (zip) fd.set("zip", zip);
    fd.set("dryRun", dryRun ? "1" : "0");

    start(async () => {
      setRun(null);
      setRunId(null);
      // Large upload goes to a Route Handler (not a Server Action) — see the route.
      let data: { runId?: string; error?: string } = {};
      try {
        const res = await fetch("/api/admin/import", { method: "POST", body: fd });
        data = await res.json().catch(() => ({}));
        if (!res.ok || !data.runId) {
          toast({ title: data.error ?? "Не удалось запустить импорт", variant: "danger" });
          return;
        }
      } catch {
        toast({ title: "Не удалось запустить импорт", variant: "danger" });
        return;
      }
      setRunId(data.runId);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Загрузка экспорта</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-file" className="text-[14px] font-medium">
              Markdown-экспорт базы (.md, до {IMPORT_MAX_MD_MB} МБ)
            </label>
            <input
              id="import-file"
              ref={fileRef}
              type="file"
              accept=".md,text/markdown"
              disabled={busy}
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              className="text-text-2 file:rounded-control file:border-border file:bg-surface-2 file:text-text-1 hover:file:border-border-strong block w-full text-[13px] file:mr-3 file:cursor-pointer file:border file:px-3 file:py-1.5 file:text-[13px]"
            />
            {fileName && <p className="text-text-3 truncate text-[12px]">{fileName}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-zip" className="text-[14px] font-medium">
              Архив с картинками (опционально, .zip, до {IMPORT_MAX_ZIP_MB} МБ)
            </label>
            <input
              id="import-zip"
              ref={zipRef}
              type="file"
              accept=".zip,application/zip"
              disabled={busy}
              onChange={(e) => setZipName(e.target.files?.[0]?.name ?? "")}
              className="text-text-2 file:rounded-control file:border-border file:bg-surface-2 file:text-text-1 hover:file:border-border-strong block w-full text-[13px] file:mr-3 file:cursor-pointer file:border file:px-3 file:py-1.5 file:text-[13px]"
            />
            {zipName && <p className="text-text-3 truncate text-[12px]">{zipName}</p>}
          </div>

          <p className="text-text-3 text-[12px]">
            Всё создаётся в статусе черновика — команда публикует после вычитки. Dry-run ничего не
            пишет в базу и служит точным зеркалом импорта.
          </p>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => submit(true)} loading={busy} type="button">
              <FileText size={16} strokeWidth={1.75} />
              Dry-run
            </Button>
            <Button onClick={() => submit(false)} loading={busy} type="button">
              <Upload size={16} strokeWidth={1.75} />
              Импортировать
            </Button>
          </div>
        </CardContent>
      </Card>

      {run && active && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-medium">
                {IMPORT_RUN_STATUS_LABEL[run.status] ?? run.status}…
              </span>
              <Badge variant={run.dryRun ? "default" : "accent"}>
                {run.dryRun ? "Dry-run" : "Импорт"}
              </Badge>
            </div>
            <ProgressBar value={PHASE_PROGRESS[run.status] ?? 0} aria-label="Прогресс импорта" />
          </CardContent>
        </Card>
      )}

      {run && run.status === "done" && <ImportReportView run={run} />}
    </div>
  );
}

function ImportReportView({ run }: { run: ClientRun }) {
  const counts = run.counts;
  const downloadReport = () => {
    if (!run.report) return;
    const blob = new Blob([run.report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-report.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const result = counts?.result as Record<string, { created: number; skipped: number }> | undefined;
  const anomalies = counts?.anomalies;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Отчёт</CardTitle>
          <Badge variant={run.dryRun ? "default" : "accent"}>
            {run.dryRun ? "Dry-run — ничего не записано" : "Импорт — записано в базу"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {result && (
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">Создано / пропущено по типам</h3>
            <ul className="divide-border flex flex-col divide-y">
              {IMPORT_COUNT_ORDER.map((key) => {
                const c = result[key];
                if (!c) return null;
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-3 py-1.5 text-[14px]"
                  >
                    <span>{IMPORT_COUNT_LABEL[key] ?? key}</span>
                    <span className="text-text-2 shrink-0 tabular-nums">
                      создано {c.created} · пропущено {c.skipped}
                    </span>
                  </li>
                );
              })}
              {counts && (
                <li className="flex items-center justify-between gap-3 py-1.5 text-[14px]">
                  <span>Изображения</span>
                  <span className="text-text-2 shrink-0 tabular-nums">
                    скопировано {counts.images.copied} · отсутствует {counts.images.missing}
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}

        {anomalies && (
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">
              Аномалии{run.anomaliesCount > 0 ? ` (${run.anomaliesCount})` : ""}
            </h3>
            <ul className="divide-border flex flex-col divide-y">
              {(Object.keys(IMPORT_ANOMALY_LABEL) as (keyof typeof anomalies)[]).map((key) => (
                <li
                  key={key}
                  className="flex items-center justify-between gap-3 py-1.5 text-[14px]"
                >
                  <span className="flex items-center gap-2">
                    {IMPORT_ANOMALY_LABEL[key]}
                    {key === "needsLatex" && anomalies.needsLatex > 0 && (
                      <Link
                        href="/admin/questions?latex=1"
                        className="text-accent text-[12px] hover:underline"
                      >
                        открыть в редакторе вопросов →
                      </Link>
                    )}
                  </span>
                  <span className="text-text-2 shrink-0 tabular-nums">{anomalies[key]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {run.report && (
          <details className="text-[13px]">
            <summary className="text-text-2 hover:text-text-1 cursor-pointer select-none">
              Полный отчёт (структура CLI-отчёта)
            </summary>
            <pre className="border-border bg-surface-2 rounded-card mt-2 max-h-96 overflow-auto border p-3 text-[12px] leading-relaxed whitespace-pre-wrap">
              {run.report}
            </pre>
          </details>
        )}

        <div>
          <Button variant="secondary" onClick={downloadReport} type="button" disabled={!run.report}>
            <Download size={16} strokeWidth={1.75} />
            Скачать отчёт .md
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
