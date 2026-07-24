"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  transferBookingAction,
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
  /** До старта меньше 24 часов — отмена засчитает страйк (spec 7.8). */
  late: boolean;
}

/**
 * «Отменить» и «Перенести» карточки брони (spec 7.8 / changelog 13.4 block 3).
 * «Перенести» больше НЕ отменяет бронь заранее — ведёт к мастеру выбора нового
 * слота (атомарный перенос на шаге подтверждения). «Отменить» — по правилам 24ч.
 */
export function CancelBookingControls({ bookingId, late }: CancelControlsProps) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const runCancel = () =>
    start(async () => {
      const res = await cancelBookingAction({ bookingId });
      if (res.ok) {
        toast({
          title: res.data.strikeIssued ? "Бронь отменена — засчитан страйк" : "Бронь отменена",
          variant: res.data.strikeIssued ? "danger" : "success",
        });
        router.push("/mocks/mine");
      } else {
        toast({ title: res.error.message, variant: "danger" });
        setOpen(false);
      }
    });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href={`/mocks/book?reschedule=${bookingId}`}>Перенести</Link>
        </Button>
        <Button variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
          Отменить
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить мок?</DialogTitle>
            <DialogDescription>
              {late
                ? "До мока меньше 24 часов — отмена засчитает страйк."
                : "Отмена бесплатна: слот освободится для других учеников."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Назад
            </Button>
            <Button variant="primary" loading={pending} onClick={runCancel}>
              Отменить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** «Перенести» — подтверждение атомарного переноса на новый слот (13.4 block 3). */
export function TransferConfirmButton({
  bookingId,
  slotId,
}: {
  bookingId: string;
  slotId: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await transferBookingAction({ bookingId, slotId });
          if (res.ok) {
            toast({
              title: res.data.strikeIssued
                ? "Бронь перенесена — засчитан страйк"
                : "Бронь перенесена",
              variant: res.data.strikeIssued ? "danger" : "success",
            });
            router.push(`/mocks/${res.data.bookingId}`);
          } else {
            toast({ title: res.error.message, variant: "danger" });
          }
        })
      }
    >
      Перенести
    </Button>
  );
}
