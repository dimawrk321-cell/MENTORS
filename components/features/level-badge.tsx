// Компактный бейдж уровня (spec 7.7/8.3, design handoff): одна пилюля surface-1 с
// градиентным кружком-номером уровня, титулом (D7 spec 13.1) и встроенным мини-
// прогресс-баром до следующего уровня. Слово «Уровень» не пишем — номер в кружке.
interface LevelBadgeProps {
  level: number;
  /** 0..1 прогресс до следующего уровня. */
  progress: number;
  /** Сколько XP до следующего уровня. */
  toNext: number;
  /** Титул уровня (spec 13.1/D7). */
  title?: string;
}

export function LevelBadge({ level, progress, toNext, title }: LevelBadgeProps) {
  const pct = Math.round(progress * 100);
  return (
    <span
      className="rounded-pill border-border bg-surface-1 inline-flex shrink-0 items-center gap-2.5 border py-1 pr-3 pl-1.5 text-[13px] font-medium"
      title={`Уровень ${level}${title ? ` · ${title}` : ""} — до уровня ${level + 1}: ${toNext} XP`}
    >
      <span
        className="flex size-[18px] items-center justify-center rounded-full text-[10px] leading-none font-semibold text-white tabular-nums"
        style={{ backgroundImage: "var(--gradient-accent)" }}
        aria-hidden="true"
      >
        {level}
      </span>
      {title && <span className="min-w-0 truncate">{title}</span>}
      <span
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Прогресс уровня ${level}`}
        className="bg-border h-[5px] w-16 shrink-0 overflow-hidden rounded-full"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundImage: "var(--gradient-accent)" }}
        />
      </span>
    </span>
  );
}
