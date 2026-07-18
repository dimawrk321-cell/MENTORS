import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// Lightweight CSS bar charts for /admin/analytics (spec 8.5: «никаких внешних
// библиотек графиков тяжелее лёгкого SVG/CSS»). Pure presentational, server-safe.

export function HBarRow({
  label,
  valueText,
  pct,
  tone = "accent",
  href,
}: {
  label: string;
  valueText: string;
  /** 0..100 fill width. */
  pct: number;
  tone?: "accent" | "warning" | "danger" | "success";
  href?: string;
}) {
  const toneClass =
    tone === "danger"
      ? "bg-danger"
      : tone === "warning"
        ? "bg-warning"
        : tone === "success"
          ? "bg-success"
          : "bg-accent";
  const labelNode = (
    <span className="w-36 shrink-0 truncate text-[13px] sm:w-48" title={label}>
      {label}
    </span>
  );
  return (
    <div className="flex items-center gap-3">
      {href ? (
        <a href={href} className="ease-app hover:text-text-1 w-36 shrink-0 sm:w-48">
          <span className="block truncate text-[13px]" title={label}>
            {label}
          </span>
        </a>
      ) : (
        labelNode
      )}
      <div className="bg-surface-2 relative h-2 flex-1 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", toneClass)}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="text-text-2 w-20 shrink-0 text-right text-[12px] tabular-nums">
        {valueText}
      </span>
    </div>
  );
}

/** Empty-state row for a chart with no data (spec 5.5). */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return <p className="text-text-3 py-4 text-[13px]">{children}</p>;
}

/** Compact stat tile (проведено моков, среднее время до фидбека …). */
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border-border flex flex-col gap-0.5 border p-3">
      <span className="text-text-2 text-[12px]">{label}</span>
      <span className="text-[20px] font-semibold">{value}</span>
    </div>
  );
}
