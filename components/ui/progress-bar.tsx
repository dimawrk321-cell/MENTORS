import { cn } from "@/lib/utils/cn";

interface ProgressBarProps {
  /** 0..100 */
  value: number;
  className?: string;
  /** Accent→violet gradient fill (design handoff) instead of solid accent. */
  gradient?: boolean;
  "aria-label"?: string;
}

/** ProgressBar (spec 5.3): hairline track + accent (or gradient) fill. */
export function ProgressBar({
  value,
  className,
  gradient = false,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn("rounded-pill bg-border h-1.5 w-full overflow-hidden", className)}
    >
      <div
        className={cn(
          "rounded-pill ease-app h-full transition-[width] duration-200",
          !gradient && "bg-accent",
        )}
        style={{
          width: `${clamped}%`,
          ...(gradient ? { backgroundImage: "var(--gradient-accent)" } : {}),
        }}
      />
    </div>
  );
}
