import { cn } from "@/lib/utils/cn";

interface ProgressBarProps {
  /** 0..100 */
  value: number;
  className?: string;
  "aria-label"?: string;
}

/** ProgressBar (spec 5.3): hairline track + accent fill. */
export function ProgressBar({ value, className, "aria-label": ariaLabel }: ProgressBarProps) {
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
        className="rounded-pill bg-accent ease-app h-full transition-[width] duration-200"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
