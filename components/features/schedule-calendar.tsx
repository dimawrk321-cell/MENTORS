"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import type { ActionResult } from "@/lib/auth/action-helpers";
import {
  addExceptionAction,
  closeDayAction,
  deleteExceptionAction,
} from "@/lib/actions/interviewer";

// Calendar tab for /interviewer/schedule (spec 12.1/C6): a 4-week grid over the
// weekly-rules view. Click a day → windows dialog (add/remove extra окна, mark/unmark
// выходной, close day). Days with a recurring rule are highlighted; the dialog
// previews the day's slots. All availability data is computed server-side and passed
// as serializable cells; only the click/dialog interactivity lives here.

export interface CalendarWindow {
  startTime: string;
  endTime: string;
}

export interface CalendarException {
  id: string;
  startTime: string;
  endTime: string;
}

export interface CalendarDay {
  dateStr: string; // YYYY-MM-DD (interviewer-local)
  dayNum: number;
  label: string; // «20 июля»
  weekdayLabel: string; // «Пн»
  isPast: boolean;
  isToday: boolean;
  hasRule: boolean;
  isDayOff: boolean;
  dayOffId: string | null;
  recurring: CalendarWindow[];
  extras: CalendarException[];
  slotTimes: string[];
}

const WEEKDAY_HEADERS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (action: () => Promise<ActionResult<unknown>>, onOk: string, after?: () => void) =>
    start(async () => {
      const res = await action();
      if (res.ok) {
        toast({ title: onOk, variant: "success" });
        after?.();
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });
  return { pending, run };
}

export function ScheduleCalendar({ days }: { days: CalendarDay[] }) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const selected = days.find((d) => d.dateStr === openDate) ?? null;

  return (
    <>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_HEADERS.map((w) => (
          <div key={w} className="text-text-3 pb-1 text-center text-[12px] font-medium">
            {w}
          </div>
        ))}
        {days.map((day) => {
          const disabled = day.isPast;
          return (
            <button
              key={day.dateStr}
              type="button"
              disabled={disabled}
              onClick={() => setOpenDate(day.dateStr)}
              aria-label={`${day.label}${day.slotTimes.length ? `, ${day.slotTimes.length} слотов` : ""}`}
              className={cn(
                "rounded-control ease-app flex min-h-16 flex-col items-start gap-1 border p-1.5 text-left transition-colors duration-150",
                disabled
                  ? "border-transparent opacity-40"
                  : "border-border hover:border-border-strong",
                day.isToday && "border-accent",
                day.hasRule && !disabled && "bg-accent/[0.06]",
              )}
            >
              <span
                className={cn(
                  "text-[13px] tabular-nums",
                  day.isToday ? "text-accent font-semibold" : "text-text-1",
                )}
              >
                {day.dayNum}
              </span>
              {day.isDayOff ? (
                <span className="text-warning text-[11px]">выходной</span>
              ) : day.slotTimes.length > 0 ? (
                <span className="text-text-3 text-[11px]">{day.slotTimes.length} сл.</span>
              ) : null}
              {day.hasRule && !day.isDayOff && (
                <span className="bg-accent mt-auto size-1.5 rounded-full" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      <Dialog open={selected !== null} onOpenChange={(o) => !o && setOpenDate(null)}>
        <DialogContent>
          {selected && <DayDialog day={selected} onClose={() => setOpenDate(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DayDialog({ day, onClose }: { day: CalendarDay; onClose: () => void }) {
  const { pending, run } = useAction();
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("21:00");

  const addExtra = () =>
    run(
      () =>
        addExceptionAction({ date: day.dateStr, kind: "extra", startTime: start, endTime: end }),
      "Доп. окно добавлено",
    );

  const removeException = (id: string) =>
    run(() => deleteExceptionAction({ exceptionId: id }), "Удалено");

  const toggleDayOff = () => {
    if (day.isDayOff && day.dayOffId) {
      run(() => deleteExceptionAction({ exceptionId: day.dayOffId! }), "Выходной снят");
    } else {
      run(
        () => addExceptionAction({ date: day.dateStr, kind: "day_off" }),
        "День отмечен выходным",
      );
    }
  };

  const closeDay = () => {
    if (!window.confirm("Закрыть день? Открытые слоты закроются, брони этого дня отменятся.")) {
      return;
    }
    run(() => closeDayAction({ date: day.dateStr }), "День закрыт", onClose);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {day.weekdayLabel}, {day.label}
        </DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-4 text-[14px]">
        {/* Повторяющиеся окна (только просмотр — правятся во вкладке «Неделя»). */}
        <div>
          <h4 className="text-text-2 mb-1.5 text-[13px] font-medium">Повторяющиеся окна</h4>
          {day.recurring.length === 0 ? (
            <p className="text-text-3 text-[13px]">Нет — этот день недели свободен от правил.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {day.recurring.map((w, i) => (
                <li key={i} className="text-text-2 tabular-nums">
                  {w.startTime}–{w.endTime}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Дополнительные окна этой даты (можно удалить). */}
        <div>
          <h4 className="text-text-2 mb-1.5 text-[13px] font-medium">Доп. окна на эту дату</h4>
          {day.extras.length === 0 ? (
            <p className="text-text-3 text-[13px]">Пока нет.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {day.extras.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="text-text-2 flex-1 tabular-nums">
                    {e.startTime}–{e.endTime}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeException(e.id)}
                    aria-label="Удалить окно"
                    className="text-text-3 ease-app hover:text-danger transition-colors duration-150"
                  >
                    <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Добавить доп. окно. */}
        {!day.isDayOff && (
          <div className="border-border flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="flex flex-col gap-1">
              <span className="text-text-3 text-[12px]">Начало</span>
              <Input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-28"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-3 text-[12px]">Конец</span>
              <Input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-28"
              />
            </label>
            <Button type="button" variant="secondary" onClick={addExtra} loading={pending}>
              <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
              Окно
            </Button>
          </div>
        )}

        {/* Превью слотов дня. */}
        {day.slotTimes.length > 0 && (
          <div>
            <h4 className="text-text-2 mb-1.5 text-[13px] font-medium">Слоты дня</h4>
            <div className="flex flex-wrap gap-1.5">
              {day.slotTimes.map((t) => (
                <span
                  key={t}
                  className="rounded-pill border-border text-text-2 border px-2 py-0.5 text-[12px] tabular-nums"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <DialogFooter className="flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={toggleDayOff} loading={pending}>
          {day.isDayOff ? "Снять выходной" : "Отметить выходным"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-danger"
          onClick={closeDay}
          loading={pending}
        >
          Закрыть день
        </Button>
      </DialogFooter>
    </>
  );
}
