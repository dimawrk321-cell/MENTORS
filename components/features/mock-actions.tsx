"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import {
  bookMockAction,
  cancelBookingAction,
  claimOfferAction,
  joinWaitlistAction,
} from "@/lib/actions/mocks";

// Клиентские кнопки моков (spec 8.3): подтверждение брони, клейм предложения,
// лист ожидания, отмена/перенос по правилам 24ч. Все идут через server actions.

export function ConfirmBookButton({ slotId, type }: { slotId: string; type: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await bookMockAction({ slotId, type });
          if (res.ok) {
            toast({ title: "Мок забронирован", variant: "success" });
            router.push(`/mocks/${res.data.bookingId}`);
          } else {
            toast({ title: res.error.message, variant: "danger" });
          }
        })
      }
    >
      Забронировать
    </Button>
  );
}

export function ClaimOfferButton({ waitlistId }: { waitlistId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await claimOfferAction({ waitlistId });
          if (res.ok) {
            toast({ title: "Слот забронирован", variant: "success" });
            router.push(`/mocks/${res.data.bookingId}`);
          } else {
            toast({ title: res.error.message, variant: "danger" });
          }
        })
      }
    >
      Забронировать слот
    </Button>
  );
}

export function JoinWaitlistButton({
  type,
  interviewerId,
}: {
  type: string;
  interviewerId?: string | null;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await joinWaitlistAction({ type, interviewerId: interviewerId ?? null });
          if (res.ok) {
            toast({
              title: res.data.created
                ? "Сообщим, как только появится слот"
                : "Ты уже в листе ожидания",
              variant: "success",
            });
            router.refresh();
          } else {
            toast({ title: res.error.message, variant: "danger" });
          }
        })
      }
    >
      Сообщить, когда появится слот
    </Button>
  );
}

interface CancelControlsProps {
  bookingId: string;
  type: string;
  /** До старта меньше 24 часов — отмена засчитает страйк (spec 7.8). */
  late: boolean;
}

/** «Отменить» и «Перенести» карточки брони (spec 7.8): одни правила, разный исход. */
export function CancelBookingControls({ bookingId, type, late }: CancelControlsProps) {
  const [mode, setMode] = useState<"cancel" | "reschedule" | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = (reschedule: boolean) =>
    start(async () => {
      const res = await cancelBookingAction({ bookingId });
      if (res.ok) {
        toast({
          title: res.data.strikeIssued ? "Бронь отменена — засчитан страйк" : "Бронь отменена",
          variant: res.data.strikeIssued ? "danger" : "success",
        });
        router.push(reschedule ? `/mocks/book?type=${type}` : "/mocks/mine");
      } else {
        toast({ title: res.error.message, variant: "danger" });
        setMode(null);
      }
    });

  const description = late
    ? "До мока меньше 24 часов — отмена засчитает страйк."
    : "Отмена бесплатна: слот освободится для других учеников.";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setMode("reschedule")}>
          Перенести
        </Button>
        <Button variant="ghost" className="text-danger" onClick={() => setMode("cancel")}>
          Отменить
        </Button>
      </div>
      <Dialog open={mode !== null} onOpenChange={(open) => !open && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "reschedule" ? "Перенести мок?" : "Отменить мок?"}</DialogTitle>
            <DialogDescription>
              {description}
              {mode === "reschedule" && " После отмены сразу перейдём к выбору нового слота."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setMode(null)}>
              Назад
            </Button>
            <Button
              variant={late ? "primary" : "primary"}
              loading={pending}
              onClick={() => run(mode === "reschedule")}
            >
              {mode === "reschedule" ? "Перенести" : "Отменить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
