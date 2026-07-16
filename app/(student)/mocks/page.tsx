import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getMocksPageData } from "@/lib/services/mock-queries";
import { MOCK_DURATION_MINUTES, MOCK_TYPE_DESCRIPTION, MOCK_TYPE_LABEL } from "@/lib/constants";
import { formatDateRu, formatDateTimeRu, MINUTE_MS, pluralRu } from "@/lib/utils/dates";
import { Card, CardContent } from "@/components/ui/card";
import { MockBookingCard } from "@/components/features/mock-booking-card";
import { ClaimOfferButton } from "@/components/features/mock-actions";

export const metadata: Metadata = {
  title: "Моки",
};

const TYPES = ["theory", "legend"] as const;

/** /mocks (spec 8.3): две карточки типов, активная бронь, плашка лока, предложения. */
export default async function MocksPage() {
  const { user } = await requireStudentZone();
  const now = new Date();
  const data = await getMocksPageData(prisma, user.id, now);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[24px] font-semibold">Мок-интервью</h1>

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
                последние 60 дней (поздние отмены или неявки). После этой даты бронирование снова
                откроется.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Активные hold-предложения из листа ожидания (spec 7.8) */}
      {data.offers.map((offer) => (
        <Card key={offer.waitlistId} className="border-l-accent border-l-2">
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

      {/* Две карточки типов (spec 8.3) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold">Забронировать мок</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {TYPES.map((type) => (
            <Link key={type} href={`/mocks/book?type=${type}`} className="group">
              <Card interactive className="h-full">
                <CardContent className="flex h-full flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="group-hover:text-accent text-[16px] font-semibold">
                      {MOCK_TYPE_LABEL[type]}
                    </p>
                    <ArrowRight
                      size={16}
                      strokeWidth={1.75}
                      className="text-text-3 group-hover:text-accent"
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

      <p className="text-text-3 text-[13px]">
        <Link href="/mocks/mine" className="hover:text-text-1 underline underline-offset-2">
          Мои моки и история →
        </Link>
      </p>
    </div>
  );
}
