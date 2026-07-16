import Link from "next/link";
import { CalendarX } from "lucide-react";
import type { SlotDay } from "@/lib/services/mock-queries";
import { EmptyState } from "@/components/ui/empty-state";

// SlotPicker (spec 5.3/7.8): вертикальный список дней с чипами времени в TZ
// ученика. Server-компонент: чипы — ссылки на шаг подтверждения (URL-мастер).

interface SlotPickerProps {
  days: SlotDay[];
  /** Ссылка шага подтверждения для выбранного слота. */
  hrefForSlot: (slotId: string) => string;
  /** Показывать имя интервьюера на чипе (объединённый календарь «Первый свободный»). */
  showInterviewer?: boolean;
}

export function SlotPicker({ days, hrefForSlot, showInterviewer = false }: SlotPickerProps) {
  if (days.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title="Свободных слотов пока нет"
        description="Встань в лист ожидания — сообщим, как только появится окно"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {days.map((day) => (
        <section key={day.dateStr} className="flex flex-col gap-2">
          <h3 className="text-text-2 text-[13px] font-medium first-letter:uppercase">
            {day.heading}
          </h3>
          <div className="flex flex-wrap gap-2">
            {day.chips.map((chip) => (
              <Link
                key={chip.slotId}
                href={hrefForSlot(chip.slotId)}
                className="rounded-control border-border ease-app hover:border-border-strong hover:bg-surface-2 flex min-h-11 flex-col items-start justify-center border px-3 py-1.5 text-left transition-colors duration-150"
              >
                <span className="text-[14px] font-medium tabular-nums">{chip.timeLabel}</span>
                {showInterviewer ? (
                  <span className="text-text-3 text-[12px]">{chip.interviewerName}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
