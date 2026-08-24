import { SegmentedProgress, type ProgressSegment } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils/cn";

// «Урок X из Y» / «Глава X из Y» + сегментированный индикатор — общая шапка обоих
// читальных экранов («Читалка v2»). Чистое представление: позиция и состояния
// шагов приходят готовыми (урок — из гейтинга курса, гайд — из порядка раздела).

export interface ReadingChapterHeaderProps {
  /** «Урок» или «Глава» — родительный падеж строит компонент. */
  kicker: string;
  /** 1-based позиция текущего шага. */
  index: number;
  total: number;
  segments: readonly ProgressSegment[];
  /** Steps inside the current lesson; its outer lesson tick is subdivided. */
  currentSegments?: readonly ProgressSegment[];
  className?: string;
}

export function ReadingChapterHeader({
  kicker,
  index,
  total,
  segments,
  currentSegments,
  className,
}: ReadingChapterHeaderProps) {
  if (total < 2) return null;
  const label = `${kicker} ${index} из ${total}`;
  return (
    <div className={cn("mb-3.5 flex flex-col gap-2", className)}>
      <span className="text-text-3 text-[11px] font-semibold tracking-[0.08em] uppercase tabular-nums">
        {label}
      </span>
      <SegmentedProgress
        segments={segments}
        expandedSegment={
          currentSegments && currentSegments.length > 1
            ? { index: index - 1, segments: currentSegments }
            : undefined
        }
        aria-label={label}
      />
    </div>
  );
}
