"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addExceptionAction,
  addRuleAction,
  closeDayAction,
  deleteExceptionAction,
  deleteRuleAction,
  updateOwnProfileAction,
} from "@/lib/actions/interviewer";
import type { ActionResult } from "@/lib/auth/action-helpers";

// Клиентские контролы кабинета интервьюера (spec 8.4): CRUD правил доступности,
// исключения, «Закрыть день», профиль. Списки и предпросмотр — server-рендер,
// revalidatePath в действиях обновляет их после мутации.

const WEEKDAYS = [
  { value: 1, label: "Понедельник" },
  { value: 2, label: "Вторник" },
  { value: 3, label: "Среда" },
  { value: 4, label: "Четверг" },
  { value: 5, label: "Пятница" },
  { value: 6, label: "Суббота" },
  { value: 7, label: "Воскресенье" },
];

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

const selectClass =
  "rounded-control border-border text-text-1 h-9 w-full border bg-transparent px-3 text-[14px] ease-app hover:border-border-strong transition-colors duration-150";

export function AddRuleForm() {
  const { pending, run } = useAction();
  const [weekday, setWeekday] = useState("1");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("21:00");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-text-3 text-[12px]">День</span>
        <select
          className={`${selectClass} w-40`}
          value={weekday}
          onChange={(e) => setWeekday(e.target.value)}
          aria-label="День недели"
        >
          {WEEKDAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-3 text-[12px]">Начало</span>
        <Input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          className="w-28"
          aria-label="Начало окна"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-3 text-[12px]">Конец</span>
        <Input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="w-28"
          aria-label="Конец окна"
        />
      </label>
      <Button
        loading={pending}
        onClick={() =>
          run(
            () => addRuleAction({ weekday: Number(weekday), startTime, endTime }),
            "Правило добавлено",
          )
        }
      >
        <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
        Добавить
      </Button>
    </div>
  );
}

export function DeleteRuleButton({ ruleId }: { ruleId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      aria-label="Удалить правило"
      onClick={() => run(() => deleteRuleAction({ ruleId }), "Правило удалено")}
    >
      <Trash2 size={15} strokeWidth={1.75} />
    </Button>
  );
}

export function AddExceptionForm() {
  const { pending, run } = useAction();
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<"day_off" | "extra">("day_off");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("21:00");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-text-3 text-[12px]">Дата</span>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-40"
          aria-label="Дата исключения"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-3 text-[12px]">Тип</span>
        <select
          className={`${selectClass} w-44`}
          value={kind}
          onChange={(e) => setKind(e.target.value as "day_off" | "extra")}
          aria-label="Тип исключения"
        >
          <option value="day_off">Выходной</option>
          <option value="extra">Дополнительное окно</option>
        </select>
      </label>
      {kind === "extra" && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-text-3 text-[12px]">Начало</span>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-28"
              aria-label="Начало окна"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-3 text-[12px]">Конец</span>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-28"
              aria-label="Конец окна"
            />
          </label>
        </>
      )}
      <Button
        loading={pending}
        disabled={!date}
        onClick={() =>
          run(
            () =>
              addExceptionAction(
                kind === "extra" ? { date, kind, startTime, endTime } : { date, kind },
              ),
            "Исключение добавлено",
          )
        }
      >
        <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
        Добавить
      </Button>
    </div>
  );
}

export function DeleteExceptionButton({ exceptionId }: { exceptionId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      aria-label="Удалить исключение"
      onClick={() => run(() => deleteExceptionAction({ exceptionId }), "Исключение удалено")}
    >
      <Trash2 size={15} strokeWidth={1.75} />
    </Button>
  );
}

export function CloseDayForm() {
  const { pending, run } = useAction();
  const [date, setDate] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-text-3 text-[12px]">Дата</span>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
            aria-label="Дата закрытия дня"
          />
        </label>
        <Button variant="secondary" disabled={!date} onClick={() => setOpen(true)}>
          Закрыть день
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Закрыть день {date}?</DialogTitle>
            <DialogDescription>
              Открытые слоты станут недоступны, а забронированные брони будут отменены — ученики
              получат уведомление и приоритет в листе ожидания.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () => closeDayAction({ date }),
                  "День закрыт",
                  () => setOpen(false),
                )
              }
            >
              Закрыть день
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ProfileFormProps {
  roomUrl: string;
  bio: string | null;
  active: boolean;
}

export function ProfileForm({
  roomUrl: initialUrl,
  bio: initialBio,
  active: initialActive,
}: ProfileFormProps) {
  const { pending, run } = useAction();
  const [roomUrl, setRoomUrl] = useState(initialUrl);
  const [bio, setBio] = useState(initialBio ?? "");
  const [active, setActive] = useState(initialActive);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-text-3 text-[12px]">Ссылка на комнату (Телемост)</span>
        <Input
          type="url"
          value={roomUrl}
          onChange={(e) => setRoomUrl(e.target.value)}
          placeholder="https://telemost.yandex.ru/..."
          aria-label="Ссылка на комнату"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-3 text-[12px]">О себе (необязательно)</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          className="rounded-control border-border text-text-1 placeholder:text-text-3 ease-app hover:border-border-strong w-full resize-y border bg-transparent px-3 py-2 text-[14px] transition-colors duration-150"
          aria-label="О себе"
        />
      </label>
      <label className="flex items-center gap-3">
        <Switch checked={active} onCheckedChange={setActive} aria-label="Принимаю брони" />
        <span className="text-[14px]">Принимаю брони</span>
      </label>
      <div>
        <Button
          loading={pending}
          onClick={() =>
            run(
              () => updateOwnProfileAction({ roomUrl, bio: bio.trim() || null, active }),
              "Профиль сохранён",
            )
          }
        >
          Сохранить профиль
        </Button>
      </div>
    </div>
  );
}
