import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Clock } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { BackButton } from "@/components/ui/back-button";
import { getBookingDetail } from "@/lib/services/mock-queries";
import { getPublishedFeedback } from "@/lib/services/feedback";
import {
  BOOKING_STATUS_LABEL,
  CANCEL_FREE_HOURS,
  MOCK_DURATION_MINUTES,
  MOCK_MARK_LABEL,
  MOCK_TYPE_LABEL,
  MOCK_VERDICT_LABEL,
} from "@/lib/constants";
import { formatDateTimeRu, MINUTE_MS } from "@/lib/utils/dates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { MockBookingCard } from "@/components/features/mock-booking-card";
import { CancelBookingControls } from "@/components/features/mock-actions";

export const metadata: Metadata = {
  title: "Мок",
};

const STATUS_VARIANT: Record<string, BadgeProps["variant"]> = {
  booked: "accent",
  completed: "success",
  cancelled_student: "default",
  cancelled_interviewer: "default",
  no_show: "danger",
};

const VERDICT_VARIANT: Record<string, BadgeProps["variant"]> = {
  ready: "success",
  needs_work: "warning",
  not_ready: "danger",
};

const MARK_VARIANT: Record<string, BadgeProps["variant"]> = {
  answered: "success",
  partial: "warning",
  failed: "danger",
};

const HOUR_MS = 60 * 60 * 1000;

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { user } = await requireStudentZone();
  const { bookingId } = await params;
  const now = new Date();

  const detail = await getBookingDetail(prisma, { userId: user.id, bookingId });
  if (!detail) notFound();

  const { booking } = detail;
  const isUpcoming = booking.status === "booked" && booking.startsAt > now;
  const late = booking.startsAt.getTime() - now.getTime() < CANCEL_FREE_HOURS * HOUR_MS;
  const feedback =
    detail.feedbackStatus === "published"
      ? await getPublishedFeedback(prisma, { userId: user.id, bookingId })
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BackButton href="/mocks/mine" label="Мои моки" />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] font-semibold">Мок: {MOCK_TYPE_LABEL[booking.type]}</h1>
          <Badge variant={STATUS_VARIANT[booking.status] ?? "default"}>
            {BOOKING_STATUS_LABEL[booking.status]}
          </Badge>
        </div>
        <p className="text-text-2 text-[14px]">
          {booking.interviewerName} · {formatDateTimeRu(booking.startsAt, user.timezone)}
        </p>
      </div>

      {isUpcoming ? (
        <section className="flex flex-col gap-3">
          <MockBookingCard
            bookingId={booking.id}
            type={booking.type}
            interviewerName={booking.interviewerName}
            roomUrl={booking.roomUrl}
            whenLabel={formatDateTimeRu(booking.startsAt, user.timezone)}
            startsAtMs={booking.startsAt.getTime()}
            endsAtMs={booking.startsAt.getTime() + MOCK_DURATION_MINUTES * MINUTE_MS}
          />
          <CancelBookingControls bookingId={booking.id} late={late} />
        </section>
      ) : null}

      {/* Фидбек (spec 7.8): опубликованный — рубрика; иначе «Ожидает фидбека» */}
      {booking.status === "completed" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">Фидбек</h2>
          {feedback ? (
            <div className="flex flex-col gap-4">
              <Card>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-text-3 text-[13px]">Вердикт:</span>
                    <Badge variant={VERDICT_VARIANT[feedback.verdict] ?? "default"}>
                      {MOCK_VERDICT_LABEL[feedback.verdict]}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {feedback.criteria.map((criterion) => (
                      <div key={criterion.key} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px]">{criterion.title}</span>
                          <span className="text-text-2 text-[13px] tabular-nums">
                            {criterion.score !== null ? `${criterion.score}/5` : "—"}
                          </span>
                        </div>
                        <ProgressBar
                          value={criterion.score !== null ? (criterion.score / 5) * 100 : 0}
                          aria-label={criterion.title}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {feedback.strengths.trim() && (
                <Card>
                  <CardContent className="flex flex-col gap-1">
                    <p className="text-text-3 text-[13px]">Сильные стороны</p>
                    <p className="text-[14px] whitespace-pre-wrap">{feedback.strengths}</p>
                  </CardContent>
                </Card>
              )}
              {feedback.growth.trim() && (
                <Card>
                  <CardContent className="flex flex-col gap-1">
                    <p className="text-text-3 text-[13px]">Зоны роста</p>
                    <p className="text-[14px] whitespace-pre-wrap">{feedback.growth}</p>
                  </CardContent>
                </Card>
              )}

              {feedback.recommendedLessons.length > 0 && (
                <Card>
                  <CardContent className="flex flex-col gap-2">
                    <p className="text-text-3 text-[13px]">Рекомендованные уроки</p>
                    <ul className="flex flex-col gap-1.5">
                      {feedback.recommendedLessons.map((lesson) => (
                        <li key={lesson.id}>
                          <Link
                            href={`/lessons/${lesson.id}`}
                            className="text-accent inline-flex items-center gap-1.5 text-[14px] hover:underline"
                          >
                            <BookOpen size={15} strokeWidth={1.75} aria-hidden="true" />
                            {lesson.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {feedback.questionMarks.length > 0 && (
                <Card>
                  <CardContent className="flex flex-col gap-2">
                    <p className="text-text-3 text-[13px]">Вопросы на моке</p>
                    <ul className="divide-border divide-y">
                      {feedback.questionMarks.map((mark) => (
                        <li
                          key={mark.questionId}
                          className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px]">{mark.textMd}</span>
                          <Badge variant={MARK_VARIANT[mark.mark] ?? "default"}>
                            {MOCK_MARK_LABEL[mark.mark]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3">
                <Clock size={18} strokeWidth={1.75} className="text-text-3 shrink-0" />
                <p className="text-text-2 text-[14px]">
                  Ожидает фидбека — интервьюер готовит разбор. Придёт уведомление, когда он будет
                  готов.
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}
