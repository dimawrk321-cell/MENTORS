import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireInterviewerZone } from "@/lib/auth/guards";
import { getRunScreenData } from "@/lib/services/mock-queries";
import { getFeedbackFormData } from "@/lib/services/feedback";
import { BOOKING_STATUS_LABEL } from "@/lib/constants";
import { formatDateTimeRu } from "@/lib/utils/dates";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RunConducting } from "@/components/features/run-conducting";
import { RubricForm } from "@/components/features/rubric-form";
import { BackButton } from "@/components/ui/back-button";

export const metadata: Metadata = {
  title: "Проведение мока",
};

// D4 (spec 13.1): unified onto BackButton (icon + 44px touch target).
function BackLink() {
  return <BackButton href="/interviewer/bookings" label="К броням" />;
}

/** /interviewer/run/[bookingId] (spec 7.8/8.4): доступен с −15 мин; проведение →
 *  фидбек (RubricForm) после завершения. */
export default async function RunPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { user } = await requireInterviewerZone();
  const { bookingId } = await params;
  const data = await getRunScreenData(prisma, {
    interviewerId: user.id,
    bookingId,
    now: new Date(),
  });
  if (!data) notFound();

  // Экран доступен с −15 мин (spec 8.4).
  if (!data.canRun) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={Clock}
          title="Экран проведения ещё закрыт"
          description={`Откроется за 15 минут до старта — ${formatDateTimeRu(data.booking.startsAt, user.timezone)}.`}
          action={
            <Button asChild variant="secondary">
              <Link href="/interviewer/bookings">К броням</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (data.booking.status === "booked") {
    return <RunConducting data={data} />;
  }

  if (data.booking.status === "completed") {
    const form = await getFeedbackFormData(prisma, { interviewerId: user.id, bookingId });
    if (form && form.draft?.status === "published") {
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-[22px] font-semibold">Мок проведён</h1>
          <Card>
            <CardContent className="flex flex-col gap-1">
              <p className="text-[15px] font-medium">Фидбек опубликован</p>
              <p className="text-text-2 text-[14px]">
                Ученик получил уведомление и видит оценки и рекомендации.
              </p>
            </CardContent>
          </Card>
          <BackLink />
        </div>
      );
    }
    if (!form) notFound();
    return (
      <div className="flex flex-col gap-4">
        <RubricForm bookingId={bookingId} form={form} />
        <BackLink />
      </div>
    );
  }

  // Отменён / неявка — терминальные статусы.
  return (
    <div className="flex flex-col gap-4">
      <EmptyState
        title={`Мок: ${BOOKING_STATUS_LABEL[data.booking.status]}`}
        description="Этот мок больше нельзя провести."
        action={
          <Button asChild variant="secondary">
            <Link href="/interviewer/bookings">К броням</Link>
          </Button>
        }
      />
    </div>
  );
}
