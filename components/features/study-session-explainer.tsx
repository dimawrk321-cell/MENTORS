import { BookOpenCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function StudySessionExplainer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-start gap-3",
        !compact && "bg-surface-2 rounded-control border-border border p-4",
      )}
    >
      <span className="bg-accent/12 text-accent flex size-9 shrink-0 items-center justify-center rounded-full">
        <BookOpenCheck size={17} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-medium">Что такое карточка занятия?</p>
        <p className="text-text-2 mt-0.5 text-[13px] leading-relaxed">
          Минутный план перед учёбой и короткая фиксация результата после. Помогает видеть реальный
          прогресс и вовремя замечать пробелы.
        </p>
      </div>
    </div>
  );
}
