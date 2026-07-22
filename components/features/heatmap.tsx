import { cn } from "@/lib/utils/cn";
import { dateOnlyUtc, formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import type { HeatmapData } from "@/lib/services/dashboard";

// Heatmap активности (spec 5.3): GitHub-стиль, 20 недель desktop / 12 mobile,
// 5 градаций зелёного. Подписи месяцев сверху, дни недели (Пн/Ср/Пт) слева,
// легенда «меньше → больше» справа снизу. Нативный title-tooltip — без JS.

// B2 (spec 13.1): floor raised 22→28 so the lowest activity clears the new
// empty-cell tint (--heat-empty) in both themes; ramp still tops at 100%.
const LEVEL_OPACITY = [0, 28, 48, 70, 100]; // % от --success по градации

// 0.3 (walk 13.2): подписи для читаемости сетки.
const MONTHS_SHORT = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
]; // prettier-ignore
const WEEKDAY_LABELS = ["Пн", "", "Ср", "", "Пт", "", ""]; // строки Пн…Вс

/** Заливка ячейки по градации (0 = пустой тайл, 1–4 = зелёная рампа). */
function levelBackground(level: number): string {
  return level === 0
    ? "var(--heat-empty)"
    : `color-mix(in srgb, var(--success) ${LEVEL_OPACITY[level]}%, transparent)`;
}

/**
 * Подпись месяца над колонкой, где месяц впервые меняется (GitHub-стиль). Левая
 * частичная неделя остаётся без подписи — так ярлыки не наезжают друг на друга.
 */
function monthLabels(columns: HeatmapData["columns"]): Array<string | null> {
  const labels: Array<string | null> = [];
  let lastMonth = columns.length > 0 ? monthOf(columns[0]!) : -1;
  columns.forEach((column, i) => {
    const m = monthOf(column);
    if (i > 0 && m !== lastMonth) {
      labels.push(MONTHS_SHORT[m] ?? null);
      lastMonth = m;
    } else {
      labels.push(null);
    }
  });
  return labels;
}

function monthOf(column: HeatmapData["columns"][number]): number {
  return Number(column[0]!.date.slice(5, 7)) - 1; // "YYYY-MM-DD" → 0..11
}

function cellTitle(cell: HeatmapData["columns"][number][number]): string {
  const date = formatDateOnlyRu(dateOnlyUtc(cell.date));
  return (
    `${date}: ` +
    `${cell.lessons} ${pluralRu(cell.lessons, "урок", "урока", "уроков")} · ` +
    `${cell.cards} ${pluralRu(cell.cards, "карточка", "карточки", "карточек")} · ` +
    `${cell.tests} ${pluralRu(cell.tests, "тест", "теста", "тестов")}`
  );
}

interface HeatmapProps {
  data: HeatmapData;
  /** Сколько последних недель показывать на мобильном (остальные скрыты). */
  mobileWeeks?: number;
}

export function Heatmap({ data, mobileWeeks = 12 }: HeatmapProps) {
  const total = data.columns.length;
  const hiddenBefore = total - mobileWeeks;
  const months = monthLabels(data.columns);

  return (
    <div className="overflow-x-auto">
      <div className="inline-flex flex-col gap-1.5">
        {/* Подписи месяцев (сверху), выровнены по колонкам-неделям */}
        <div className="flex gap-1">
          <div className="w-8 shrink-0" aria-hidden="true" />
          {data.columns.map((_, weekIndex) => (
            <div
              key={weekIndex}
              aria-hidden="true"
              className={cn(
                "text-text-3 w-4 shrink-0 text-[10px] leading-none whitespace-nowrap",
                weekIndex < hiddenBefore && "max-md:hidden",
              )}
            >
              {months[weekIndex] ?? ""}
            </div>
          ))}
        </div>

        {/* Дни недели (слева) + колонки-недели */}
        <div className="flex gap-1">
          <div
            aria-hidden="true"
            className="text-text-3 flex w-8 shrink-0 flex-col gap-1 pr-1.5 text-right text-[10px]"
          >
            {WEEKDAY_LABELS.map((label, i) => (
              <span key={i} className="flex h-4 items-center justify-end leading-none">
                {label}
              </span>
            ))}
          </div>

          {data.columns.map((column, weekIndex) => (
            <div
              key={weekIndex}
              className={cn("flex flex-col gap-1", weekIndex < hiddenBefore && "max-md:hidden")}
            >
              {column.map((cell) => (
                <span
                  key={cell.date}
                  title={cell.future ? undefined : cellTitle(cell)}
                  aria-hidden={cell.future || undefined}
                  className="border-border size-4 rounded-[3px] border"
                  style={
                    cell.future
                      ? { opacity: 0 } // будущее текущей недели — невидимо, но держит сетку
                      : { background: levelBackground(cell.level) }
                  }
                />
              ))}
            </div>
          ))}
        </div>

        {/* Легенда «меньше → больше» (справа снизу) */}
        <div className="text-text-3 flex items-center justify-end gap-1 pt-0.5 text-[10px]">
          <span>меньше</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className="border-border size-3 rounded-[3px] border"
              style={{ background: levelBackground(level) }}
            />
          ))}
          <span>больше</span>
        </div>
      </div>
    </div>
  );
}
