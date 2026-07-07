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
      {children}
    </aside>
  );
}
