import { ProgressBar } from "@/components/ui/progress-bar";

// Компактный бейдж «Уровень N» с прогрессом до следующего (spec 7.7/8.3).
// Полная витрина уровней — V1; здесь только шапка дашборда.
interface LevelBadgeProps {
  level: number;
  /** 0..1 прогресс до следующего уровня. */
  progress: number;
  /** Сколько XP до следующего уровня. */
  toNext: number;
}

export function LevelBadge({ level, progress, toNext }: LevelBadgeProps) {
  return (
    <div className="flex items-center gap-2" title={`До уровня ${level + 1}: ${toNext} XP`}>
      <span className="rounded-pill border-border bg-surface-2 shrink-0 border px-2.5 py-1 text-[13px] font-medium">
        Уровень {level}
      </span>
      <div className="w-20">
        <ProgressBar
          value={progress * 100}
          aria-label={`Прогресс уровня ${level}: ${Math.round(progress * 100)}%`}
        />
      </div>
    </div>
  );
}
