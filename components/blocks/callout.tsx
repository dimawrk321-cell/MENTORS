import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// Spec 5.3: 4 types — совет (accent) / важное (warning) / предупреждение (danger)
// / материал (text-2); 2px left bar, 6% background tint.
type CalloutType = "tip" | "important" | "warning" | "material";

const typeClasses: Record<CalloutType, string> = {
  tip: "border-l-accent bg-accent/6",
  important: "border-l-warning bg-warning/6",
  warning: "border-l-danger bg-danger/6",
  material: "border-l-text-2 bg-text-2/6",
};

export function Callout({ type, children }: { type?: string; children?: ReactNode }) {
  const resolved: CalloutType = (["tip", "important", "warning", "material"] as const).includes(
    type as CalloutType,
  )
    ? (type as CalloutType)
    : "tip";

  return (
    <aside
      className={cn(
        "lesson-callout rounded-r-control my-5 border-l-2 px-4 py-3",
        typeClasses[resolved],
      )}
    >
      {resolved === "material" ? <MaterialGrid>{children}</MaterialGrid> : children}
    </aside>
  );
}

/**
 * Lays external-material link cards out as a wrapping card grid (walk 12.3, P3c).
 * `display:contents` on the wrapping paragraphs/lists lets the cards become direct
 * flex items so they flow into columns; prose and human-labelled links flow too.
 */
export function MaterialGrid({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 [&_li]:contents [&_ol]:contents [&_p]:contents [&_ul]:contents">
      {children}
    </div>
  );
}
