import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Lock, Settings, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getMocksPageData } from "@/lib/services/mock-queries";
import {
  MOCK_DURATION_MINUTES,
  MOCK_TYPE_DESCRIPTION,
  MOCK_TYPE_LABEL,
  STRIKE_WINDOW_DAYS,
} from "@/lib/constants";
import { formatDateRu, formatDateTimeRu, MINUTE_MS, pluralRu } from "@/lib/utils/dates";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { IconTile } from "@/components/features/icon-tile";
import { MockBookingCard } from "@/components/features/mock-booking-card";
import { MockLockedNote } from "@/components/features/mock-locked-note";
import { getMockBookingAccess } from "@/lib/services/mock-access";
import { ClaimOfferButton } from "@/components/features/mock-actions";

// Tile per mock type (design handoff): accent «шестерёнка» for theory, violet «книга» for legend.
const TYPE_TILE = {
  theory: { icon: Settings, colorVar: "var(--accent)" },
  legend: { icon: BookOpen, colorVar: "var(--violet)" },
} as const;

export const metadata: Metadata = {
  title: "Моки",
};

const TYPES = ["theory", "legend"] as const;

/** /mocks (spec 8.3): две карточки типов, активная бронь, плашка лока, предложения. */
export default async function MocksPage() {
  const { user } = await requireStudentZone();
  const now = new Date();
  const [data, access] = await Promise.all([
    getMocksPageData(prisma, user.id, now),
    getMockBookingAccess(prisma, user.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Мок-интервью"
        subtitle="Тренировочные собеседования с живыми интервьюерами"
      />

      {/* Плашка лока при страйках (spec 7.8/8.3) */}
      {data.lock && (
        <Card className="border-l-danger border-l-2">
          <CardContent className="flex gap-3">
            <Lock size={18} strokeWidth={1.75} className="text-danger mt-0.5 shrink-0" />
            <div>
              <p className="text-[15px] font-medium">
                Бронирование недоступно до {formatDateRu(data.lock.lockedUntil, user.timezone)}
              </p>
              <p className="text-text-2 mt-1 text-[13px]">
                {data.lock.recentStrikes.length}{" "}
                {pluralRu(data.lock.recentStrikes.length, "страйк", "страйка", "страйков")} за
                последние {STRIKE_WINDOW_DAYS} дней (поздние отмены, поздние переносы или неявки).
                После этой даты бронирование снова откроется.
              </p>
              {/* Заход B.2: правило лока считает разрыв МЕЖДУ соседними страйками
                  (computeBookingLock), а не «два за календарные два месяца» — без
                  этой строки ученик ждёт разблокировки не в тот день и не знает,
                  что новый страйк её отодвинет. Механику целиком не объясняем:
                  человеку нужны дата и последствие. */}
              <p className="text-text-3 mt-1 text-[13px]">
                Дата считается от последнего страйка: следующий страйк в течение{" "}
                {STRIKE_WINDOW_DAYS} дней сдвинет её дальше.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Активные hold-предложения из листа ожидания (spec 7.8) */}
      {data.offers.map((offer) => (
        <Card
          key={offer.waitlistId}
          style={{
            borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)",
            boxShadow: "0 0 24px color-mix(in srgb, var(--accent) 10%, transparent)",
          }}
        >
          <CardContent className="flex flex-wrap items-center gap-3">
            <Sparkles size={18} strokeWidth={1.75} className="text-accent shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">Освободился слот — успей забронировать</p>
              <p className="text-text-2 text-[13px]">
                {MOCK_TYPE_LABEL[offer.type]} · {offer.interviewerName} ·{" "}
                {formatDateTimeRu(offer.startsAt, user.timezone)} · действует 2 часа
              </p>
            </div>
            <ClaimOfferButton waitlistId={offer.waitlistId} />
          </CardContent>
        </Card>
      ))}

      {/* Активная бронь (spec 8.3) */}
      {data.activeBooking && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Ближайший мок</h2>
          <MockBookingCard
            bookingId={data.activeBooking.bookingId}
            type={data.activeBooking.type}
            interviewerName={data.activeBooking.interviewerName}
            roomUrl={data.activeBooking.roomUrl}
            whenLabel={formatDateTimeRu(data.activeBooking.startsAt, user.timezone)}
            startsAtMs={data.activeBooking.startsAt.getTime()}
            endsAtMs={data.activeBooking.startsAt.getTime() + MOCK_DURATION_MINUTES * MINUTE_MS}
          />
        </section>
      )}

      {/* Заход B.1: бронь открывается после первого пройденного курса. Плашка
          страйков (выше) остаётся отдельной — это два разных сообщения. */}
      {!access.open ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Забронировать мок</h2>
          <MockLockedNote access={access} />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Забронировать мок</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {TYPES.map((type) => (
              <Link key={type} href={`/mocks/book?type=${type}`} className="group block min-w-0">
                <Card interactive className="h-full">
                  <CardContent className="flex h-full flex-col gap-2 p-5">
                    <div className="flex items-center gap-3">
                      <IconTile icon={TYPE_TILE[type].icon} colorVar={TYPE_TILE[type].colorVar} />
                      <p className="group-hover:text-accent min-w-0 flex-1 text-[16px] font-semibold">
                        {MOCK_TYPE_LABEL[type]}
                      </p>
                      <ArrowRight
                        size={16}
                        strokeWidth={1.75}
                        className="text-text-3 group-hover:text-accent shrink-0"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="text-text-2 text-[14px]">{MOCK_TYPE_DESCRIPTION[type]}</p>
                    <p className="text-text-3 mt-auto text-[12px]">
                      {MOCK_DURATION_MINUTES} минут с живым интервьюером
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-text-3 text-[13px]">
        <Link href="/mocks/mine" className="hover:text-text-1 underline underline-offset-2">
          Мои моки и история →
        </Link>
      </p>
    </div>
  );
}
