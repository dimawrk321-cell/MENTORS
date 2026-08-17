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
import { useViewOnly, ViewOnlyNote, VIEW_ONLY_TITLE } from "@/components/features/view-only";
import { MOCK_LOCKED_TITLE } from "@/lib/constants";
import { pluralRu } from "@/lib/utils/dates";

// Клиентские кнопки моков (spec 8.3): подтверждение брони, клейм предложения,
// лист ожидания, отмена/перенос по правилам 24ч. Все идут через server actions.
//
// «Глазами ученика» (spec 7.2): бронировать и отменять чужие моки нельзя, и это
// видно сразу — иначе ментор проходил мастер выбора слота до конца и упирался в
// красный тост на последнем шаге.

export function ConfirmBookButton({ slotId, type }: { slotId: string; type: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const viewOnly = useViewOnly();

  if (viewOnly) {
    return (
      <div className="flex flex-col gap-2">
        <Button disabled title={VIEW_ONLY_TITLE}>
          Забронировать
        </Button>
        <ViewOnlyNote>Режим просмотра: бронь не оформляется.</ViewOnlyNote>
      </div>
    );
  }

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
  const viewOnly = useViewOnly();
  return (
    <Button
      size="sm"
      loading={pending}
      disabled={viewOnly}
      title={viewOnly ? VIEW_ONLY_TITLE : undefined}
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
  const viewOnly = useViewOnly();
  return (
    <Button
      variant="secondary"
      loading={pending}
      disabled={viewOnly}
      title={viewOnly ? VIEW_ONLY_TITLE : undefined}
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
  /** До старта меньше окна бесплатной отмены — отмена засчитает страйк (spec 7.8). */
  late: boolean;
  /**
   * Окно бесплатной отмены в часах. Приходит из настроек платформы
   * (`ops_cancel_free_hours`), а не из константы: и решение «поздняя ли отмена»,
   * и текст диалога должны совпадать с тем, что применит сервер (заход B.2).
   */
  cancelFreeHours: number;
  /**
   * Заход B.1: перенос создаёт новую бронь, поэтому подчиняется правилу «после
   * первого курса». Отмена — нет: отнимать выход из уже занятого слота нельзя.
   */
  transferOpen?: boolean;
}

/**
 * «Отменить» и «Перенести» карточки брони (spec 7.8 / changelog 13.4 block 3).
 * «Перенести» больше НЕ отменяет бронь заранее — ведёт к мастеру выбора нового
 * слота (атомарный перенос на шаге подтверждения). «Отменить» — по правилам 24ч.
 */
export function CancelBookingControls({
  bookingId,
  late,
  cancelFreeHours,
  transferOpen = true,
}: CancelControlsProps) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const viewOnly = useViewOnly();

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
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {viewOnly || !transferOpen ? (
            <Button
              variant="secondary"
              disabled
              title={viewOnly ? VIEW_ONLY_TITLE : MOCK_LOCKED_TITLE}
            >
              Перенести
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href={`/mocks/book?reschedule=${bookingId}`}>Перенести</Link>
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => setOpen(true)}
            disabled={viewOnly}
            title={viewOnly ? VIEW_ONLY_TITLE : undefined}
          >
            Отменить
          </Button>
        </div>
        {viewOnly && <ViewOnlyNote>Режим просмотра: бронь ученика не меняется.</ViewOnlyNote>}
        {!viewOnly && !transferOpen && (
          <p className="text-text-3 text-[13px]">
            {MOCK_LOCKED_TITLE}. Эту бронь можно провести или отменить.
          </p>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить мок?</DialogTitle>
            <DialogDescription>
              {late
                ? `До мока меньше ${cancelFreeHours} ${pluralRu(cancelFreeHours, "часа", "часов", "часов")} — отмена засчитает страйк.`
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
  const viewOnly = useViewOnly();

  if (viewOnly) {
    return (
      <div className="flex flex-col gap-2">
        <Button disabled title={VIEW_ONLY_TITLE}>
          Перенести
        </Button>
        <ViewOnlyNote>Режим просмотра: перенос не выполняется.</ViewOnlyNote>
      </div>
    );
  }

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
