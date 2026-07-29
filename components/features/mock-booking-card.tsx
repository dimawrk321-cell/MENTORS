"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Video } from "lucide-react";
import { isRoomUrlReady, MOCK_TYPE_LABEL } from "@/lib/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/features/icon-tile";

// Карточка ближайшего/активного мока (spec 8.3, design «Главная v2»): вертикальная
// карточка — плитка-иконка + тип/интервьюер/дата с инлайн-отсчётом сверху, кнопки
// «Подключиться»/«Подробнее» прижаты вниз. Клиентская — таймер живой.

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
  if (nowMs >= endsAtMs) return "завершён";
  if (nowMs >= startsAtMs) return "идёт сейчас";
  const diffMin = Math.ceil((startsAtMs - nowMs) / 60000);
  if (diffMin < 60) return `через ${diffMin} мин`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours < 24) return `через ${hours} ч ${mins} мин`;
  const days = Math.floor(hours / 24);
  return `через ${days} дн ${hours % 24} ч`;
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
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3.5">
        <div className="flex items-center gap-3">
          <IconTile icon={Video} colorVar="var(--violet)" />
          <div className="min-w-0 flex-1">
            <p className="text-text-3 truncate text-[13px]">
              Мок · {MOCK_TYPE_LABEL[props.type] ?? props.type} · {props.interviewerName}
            </p>
            <p className="text-[17px] font-semibold" aria-live="polite">
              {props.whenLabel}
              {countdown && (
                <span className="text-text-2 text-[13px] font-normal"> · {countdown}</span>
              )}
            </p>
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2">
          {canConnect ? (
            <Button asChild>
              <a href={props.roomUrl} target="_blank" rel="noopener noreferrer">
                Подключиться
              </a>
            </Button>
          ) : (
            <Button
              disabled
              title={
                roomReady
                  ? "Станет активной за 15 минут до старта"
                  : "Интервьюер ещё не указал ссылку на комнату"
              }
            >
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
