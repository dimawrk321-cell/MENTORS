"use client";

import { useState, useTransition } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { extendAccessAction } from "@/lib/actions/students";
import { EXTENSION_MONTH_DAYS } from "@/lib/constants";

/** Spec 7.1.7: «+1 месяц», «+3 месяца», «до даты»; мёртвые дни не съедаются. */
export function ExtendAccessControls({ userId }: { userId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState("");
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();

  function extend(input: { kind: "days"; days: number } | { kind: "until"; date: string }): void {
    startTransition(async () => {
      const result = await extendAccessAction({
        userId,
        ...input,
        ...(input.kind === "until" && comment.trim() ? { comment: comment.trim() } : {}),
      });
      if (result.ok) {
        toast({ title: `Доступ продлён до ${result.data.newAccessUntilText}`, variant: "success" });
        setDialogOpen(false);
        setDate("");
        setComment("");
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() => extend({ kind: "days", days: EXTENSION_MONTH_DAYS })}
      >
        +1 месяц
      </Button>
      <Button
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() => extend({ kind: "days", days: EXTENSION_MONTH_DAYS * 3 })}
      >
        +3 месяца
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
        <CalendarPlus size={14} strokeWidth={1.75} aria-hidden="true" />
        До даты
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Продлить до даты</DialogTitle>
            <DialogDescription>
              Доступ будет действовать до конца выбранного дня по таймзоне ученика.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="extend-date" className="text-text-2 text-[13px]">
                Дата
              </label>
              <Input
                id="extend-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="extend-comment" className="text-text-2 text-[13px]">
                Комментарий (необязательно)
              </label>
              <Input
                id="extend-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Например: оплата продления"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              loading={pending}
              disabled={!date}
              onClick={() => extend({ kind: "until", date })}
            >
              Продлить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
