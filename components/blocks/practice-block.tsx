import type { ReactNode } from "react";
import { Dumbbell } from "lucide-react";

/** :::practice — блок «Практика» с внешними ссылками (spec 7.3). */
export function PracticeBlock({ children }: { children?: ReactNode }) {
  return (
    <section className="lesson-callout rounded-card border-border bg-surface-1 my-5 border p-4">
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
        <Dumbbell size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Практика
      </h3>
      {children}
    </section>
  );
}
