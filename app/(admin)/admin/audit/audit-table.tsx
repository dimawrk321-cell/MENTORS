"use client";

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { loadMoreAuditAction } from "@/lib/actions/audit";
import type { AuditRow } from "@/lib/services/audit";

interface Filters {
  actorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
}

/** Rows accumulate as the operator loads more pages; each row expands its diff. */
export function AuditTable({
  initialRows,
  initialCursor,
  filters,
  timezone,
}: {
  initialRows: AuditRow[];
  initialCursor: string | null;
  filters: Filters;
  timezone: string;
}) {
  const [rows, setRows] = useState<AuditRow[]>(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const loadMore = () => {
    if (!cursor) return;
    start(async () => {
      const res = await loadMoreAuditAction({ ...filters, cursor });
      if (res.ok) {
        setRows((prev) => [...prev, ...res.data.rows]);
        setCursor(res.data.nextCursor);
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  };

  if (rows.length === 0) {
    return <p className="text-text-2 py-8 text-center text-[14px]">Записей аудита нет.</p>;
  }

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(d));

  return (
    <div className="flex flex-col gap-3">
      <ul className="rounded-card border-border divide-border divide-y border">
        {rows.map((row) => {
          const open = expanded === row.id;
          const hasDiff = row.before != null || row.after != null;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => hasDiff && setExpanded(open ? null : row.id)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-2.5 text-left",
                  hasDiff && "hover:bg-surface-2 ease-app transition-colors duration-150",
                )}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium">{row.action}</span>
                  <span className="text-text-3 ml-2 text-[12px]">
                    {row.entityType} · {row.entityId}
                  </span>
                  <span className="text-text-3 block text-[12px]">{row.actorName}</span>
                </div>
                <span className="text-text-3 shrink-0 text-[12px]">{fmt(row.createdAt)}</span>
                {hasDiff && (
                  <ChevronDown
                    size={15}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={cn(
                      "text-text-3 mt-0.5 shrink-0 transition-transform duration-150",
                      open && "rotate-180",
                    )}
                  />
                )}
              </button>
              {open && hasDiff && (
                <div className="border-border grid gap-3 border-t px-4 py-3 sm:grid-cols-2">
                  <DiffPane label="Было" value={row.before} />
                  <DiffPane label="Стало" value={row.after} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {cursor && (
        <div>
          <Button variant="secondary" size="sm" loading={pending} onClick={loadMore}>
            Показать ещё
          </Button>
        </div>
      )}
    </div>
  );
}

function DiffPane({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-text-3 mb-1 text-[11px] tracking-wide uppercase">{label}</p>
      <pre className="bg-surface-2 rounded-control text-text-2 overflow-x-auto p-2 text-[12px] whitespace-pre-wrap">
        {value == null ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
