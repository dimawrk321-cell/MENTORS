"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Video } from "lucide-react";
import { isRoomUrlReady, MOCK_TYPE_LABEL } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Карточка ближайшего/активного мока (spec 8.3): обратный отсчёт + «Подключиться»
// (активна за 15 мин до старта, ведёт на room_url). Клиентская — таймер живой.

const CONNECT_LEAD_MS = 15 * 60 * 1000;

interface MockBookingCardProps {
  bookingId: string;
  type: string;
  interviewerName: string;
  roomUrl: string;
  whenLabel: string;
  startsAtMs: number;
  endsAtMs: number;
}

function countdownLabel(startsAtMs: number, endsAtMs: number, nowMs: number): string {
  if (nowMs >= endsAtMs) return "Мок завершён";
  if (nowMs >= startsAtMs) return "Идёт сейчас";
  const diffMin = Math.ceil((startsAtMs - nowMs) / 60000);
  if (diffMin < 60) return `Начнётся через ${diffMin} мин`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours < 24) return `Начнётся через ${hours} ч ${mins} мин`;
  const days = Math.floor(hours / 24);
  return `Начнётся через ${days} дн ${hours % 24} ч`;
}

export function MockBookingCard(props: MockBookingCardProps) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // До гидратации рендерим окно как недоступное для подключения (SSR-совместимо).
  const roomReady = isRoomUrlReady(props.roomUrl);
  const canConnect =
    roomReady &&
    nowMs !== null &&
    nowMs >= props.startsAtMs - CONNECT_LEAD_MS &&
    nowMs < props.endsAtMs;
  const countdown = nowMs === null ? "" : countdownLabel(props.startsAtMs, props.endsAtMs, nowMs);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="rounded-pill border-border bg-surface-2 flex size-10 shrink-0 items-center justify-center border">
          <Video size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-text-3 text-[13px]">
            Мок · {MOCK_TYPE_LABEL[props.type] ?? props.type} · {props.interviewerName}
          </p>
          <p className="text-[16px] font-semibold">{props.whenLabel}</p>
          <p className="text-text-2 text-[13px]" aria-live="polite">
            {countdown || " "}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!roomReady ? (
            <Badge variant="warning" title="Интервьюер ещё не указал ссылку на комнату">
              Комната не указана
            </Badge>
          ) : canConnect ? (
            <Button asChild>
              <a href={props.roomUrl} target="_blank" rel="noopener noreferrer">
                Подключиться
              </a>
            </Button>
          ) : (
            <Button disabled title="Станет активной за 15 минут до старта">
              Подключиться
            </Button>
          )}
          <Button asChild variant="secondary">
            <Link href={`/mocks/${props.bookingId}`}>Подробнее</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
