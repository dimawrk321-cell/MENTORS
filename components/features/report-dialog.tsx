"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { reportContentAction } from "@/lib/actions/content";

const TYPES = [
  { value: "error" as const, label: "Ошибка в материале" },
  { value: "unclear" as const, label: "Непонятно объяснено" },
];

/** «⚑ Нашёл ошибку / непонятно» — floating action (spec 7.3) → content_reports. */
export function ReportDialog({ lessonId }: { lessonId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"error" | "unclear">("error");
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(): void {
    startTransition(async () => {
      const result = await reportContentAction({ lessonId, type, text: text || undefined });
      if (!result) return;
      if (result.ok) {
        toast({ title: "Спасибо! Посмотрим и поправим", variant: "success" });
        setOpen(false);
        setText("");
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // bottom-24 clears the mobile bottom nav; md+ hugs the corner.
        className="rounded-pill border-border bg-surface-2 text-text-2 shadow-surface-2 ease-app hover:text-text-1 fixed right-4 bottom-24 z-40 flex h-10 items-center gap-2 border px-4 text-[13px] transition-colors duration-150 md:bottom-6"
      >
        <Flag size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="max-sm:hidden">Нашёл ошибку / непонятно</span>
        <span className="sm:hidden">Ошибка?</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сообщить о проблеме</DialogTitle>
            <DialogDescription>Команда увидит обращение и поправит материал.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {TYPES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setType(option.value)}
                  aria-pressed={type === option.value}
                  className={cn(
                    "rounded-pill ease-app h-9 border px-4 text-[13px] transition-colors duration-150",
                    type === option.value
                      ? "border-accent bg-accent/12 text-accent"
                      : "border-border text-text-2 hover:border-border-strong hover:text-text-1",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="report-text" className="text-text-2 text-[13px]">
                Комментарий (необязательно)
              </label>
              <textarea
                id="report-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Что именно не так?"
                className="rounded-control border-border text-text-1 ease-app placeholder:text-text-3 hover:border-border-strong w-full resize-y border bg-transparent px-3 py-2 text-[14px] transition-colors duration-150"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button loading={pending} onClick={submit}>
              Отправить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
