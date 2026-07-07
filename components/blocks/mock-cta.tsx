import type { ReactNode } from "react";
import Link from "next/link";
import { Video } from "lucide-react";
import { Button } from "@/components/ui/button";

const TYPE_LABEL: Record<string, string> = {
  theory: "ML-теория",
  legend: "По легенде",
};

/**
 * :::mock{type} — CTA «Забронировать мок» (spec 7.3, мок-уроки Soft Skills).
 * The booking flow ships at stage 6; the link points ahead like the rest of
 * the future routes. Auto-completion of mock lessons also arrives at stage 6.
 */
export function MockCta({ type = "legend", children }: { type?: string; children?: ReactNode }) {
  const label = TYPE_LABEL[type] ?? type;
  return (
    <section className="rounded-card border-border bg-surface-1 my-5 border p-5">
      <h3 className="mb-1 flex items-center gap-2 text-[16px] font-semibold">
        <Video size={17} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Мок-интервью: {label}
      </h3>
      <div className="text-text-2 mb-4 text-[14px]">
        {children || <p>Этот урок закрывается практикой — забронируй мок с живым интервьюером.</p>}
      </div>
      <Button asChild variant="secondary">
        <Link href={`/mocks/book?type=${type}`}>Забронировать мок</Link>
      </Button>
    </section>
  );
}
