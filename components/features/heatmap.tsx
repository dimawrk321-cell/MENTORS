import { cn } from "@/lib/utils/cn";
import { dateOnlyUtc, formatDateOnlyRu, pluralRu } from "@/lib/utils/dates";
import type { HeatmapData } from "@/lib/services/dashboard";

// Heatmap активности (spec 5.3): GitHub-стиль, 26 недель desktop / 12 mobile,
// 5 градаций зелёного, tooltip с датой и действиями (дата + уроки/карточки/тесты).
// Нативный title-tooltip — без JS, доступно и производительно на 182 ячейках.

const LEVEL_OPACITY = [0, 22, 42, 66, 100]; // % от --success по градации

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
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1">
        {data.columns.map((column, weekIndex) => (
          <div
            key={weekIndex}
            className={cn(
              "flex flex-col gap-1",
              weekIndex < total - mobileWeeks && "max-md:hidden",
            )}
          >
            {column.map((cell) => (
              <span
                key={cell.date}
                title={cell.future ? undefined : cellTitle(cell)}
                aria-hidden={cell.future || undefined}
                className="border-border size-3 rounded-[3px] border"
                style={
                  cell.future
                    ? { opacity: 0 }
                    : cell.level === 0
                      ? undefined
                      : {
                          background: `color-mix(in srgb, var(--success) ${LEVEL_OPACITY[cell.level]}%, transparent)`,
                          borderColor: "transparent",
                        }
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
