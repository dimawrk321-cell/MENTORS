"use client";

import { useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { resolveContentReportAction } from "@/lib/actions/admin";

/** Resolves a content report straight from the Пульт widget (spec 8.5). */
export function ResolveReportButton({ reportId }: { reportId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Отметить решённым"
      title="Отметить решённым"
      onClick={() =>
        start(async () => {
          const res = await resolveContentReportAction(reportId);
          if (res.ok) toast({ title: "Репорт решён", variant: "success" });
          else toast({ title: res.error.message, variant: "danger" });
        })
      }
      className="rounded-control border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 flex size-7 shrink-0 items-center justify-center border transition-colors duration-150 disabled:opacity-50"
    >
      <Check size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
