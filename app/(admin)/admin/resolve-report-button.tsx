"use client";

import { useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { resolveContentReportAction } from "@/lib/actions/admin";

/** Resolves a content report straight from the Пульт widget (spec 8.5). */
export function ResolveReportButton({ reportId }: { reportId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title="Отметить решённым"
      onClick={() =>
        start(async () => {
          const res = await resolveContentReportAction(reportId);
          if (res.ok) toast({ title: "Репорт решён", variant: "success" });
          else toast({ title: res.error.message, variant: "danger" });
        })
      }
      className="border-border text-text-1 ease-app hover:border-border-strong hover:bg-surface-2 flex h-[30px] shrink-0 items-center rounded-[8px] border px-3 text-[12px] font-medium transition-colors duration-150 disabled:opacity-50"
    >
      Решён
    </button>
  );
}
