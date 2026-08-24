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

/** Per-step state of a {@link SegmentedProgress} tick. */
export type ProgressSegment = "done" | "current" | "todo" | "locked";

const segmentClasses: Record<ProgressSegment, string> = {
  done: "bg-accent/55",
  current: "",
  todo: "bg-border",
  // A locked step reads the same as a future one in a 3px tick; the lock itself
  // is carried by the navigation card, not by the indicator.
  locked: "bg-border",
};

/** Above this the ticks turn into hairline mush — fall back to a plain bar. */
const MAX_SEGMENTS = 24;

/**
 * Segmented progress (design v2): one tick per step, the current step filled
 * with the brand gradient. Used by the «Урок X из Y» / «Глава X из Y» reading
 * header; degrades to a plain gradient ProgressBar for very long sequences.
 */
export function SegmentedProgress({
  segments,
  expandedSegment,
  className,
  "aria-label": ariaLabel,
}: {
  segments: readonly ProgressSegment[];
  /** Split one outer tick into the steps of the current lesson. */
  expandedSegment?: { index: number; segments: readonly ProgressSegment[] };
  className?: string;
  "aria-label": string;
}) {
  if (segments.length === 0) return null;
  if (segments.length > MAX_SEGMENTS) {
    const done = segments.filter((s) => s === "done" || s === "current").length;
    return (
      <ProgressBar
        value={(done / segments.length) * 100}
        gradient
        aria-label={ariaLabel}
        className={cn("h-1", className)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn("flex w-full items-center gap-1", className)}
    >
      {segments.map((state, index) => {
        if (expandedSegment?.index === index && expandedSegment.segments.length > 1) {
          return (
            <span
              key={index}
              data-expanded-progress-segment="true"
              className="rounded-pill flex h-1 min-w-1.5 flex-1 gap-px overflow-hidden"
              aria-hidden="true"
            >
              {expandedSegment.segments.map((innerState, innerIndex) => (
                <span
                  key={innerIndex}
                  data-step-progress-segment={innerState}
                  className={cn("h-full min-w-px flex-1", segmentClasses[innerState])}
                  style={
                    innerState === "current"
                      ? { backgroundImage: "var(--gradient-accent)" }
                      : undefined
                  }
                />
              ))}
            </span>
          );
        }
        return (
          <span
            key={index}
            className={cn("rounded-pill h-1 min-w-1.5 flex-1", segmentClasses[state])}
            style={state === "current" ? { backgroundImage: "var(--gradient-accent)" } : undefined}
          />
        );
      })}
    </div>
  );
}
