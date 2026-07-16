import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireInterviewerZone } from "@/lib/auth/guards";
import { getInterviewerBookings, type InterviewerBookingRow } from "@/lib/services/mock-queries";
import { cancelByInterviewerAction } from "@/lib/actions/interviewer";
import { isRoomUrlReady, MOCK_TYPE_LABEL } from "@/lib/constants";
import { formatDateTimeRu } from "@/lib/utils/dates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionButton } from "@/components/features/action-button";

export const metadata: Metadata = {
  title: "Брони",
};

function BookingCard({ row, timezone }: { row: InterviewerBookingRow; timezone: string }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">{formatDateTimeRu(row.startsAt, timezone)}</p>
          <p className="text-text-2 text-[13px]">
            <Link
              href={`/admin/students/${row.studentId}`}
              className="hover:text-text-1 underline underline-offset-2"
            >
              {row.studentName}
            </Link>{" "}
            · {MOCK_TYPE_LABEL[row.type]}
          </p>
        </div>
        {isRoomUrlReady(row.roomUrl) ? (
          <Badge variant="accent">{MOCK_TYPE_LABEL[row.type]}</Badge>
        ) : (
          <Badge variant="warning" title="Укажи ссылку на комнату в расписании">
            Комната не указана
          </Badge>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {isRoomUrlReady(row.roomUrl) ? (
            <Button asChild variant="secondary" size="sm">
              <a href={row.roomUrl} target="_blank" rel="noopener noreferrer">
                Открыть комнату
              </a>
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled title="Ссылка на комнату не указана">
              Открыть комнату
            </Button>
          )}
          {row.canRun ? (
            <Button asChild size="sm">
              <Link href={`/interviewer/run/${row.bookingId}`}>Провести</Link>
            </Button>
          ) : (
            <Button size="sm" disabled title="Доступно за 15 минут до старта">
              Провести
            </Button>
          )}
          <ActionButton
            action={() => cancelByInterviewerAction({ bookingId: row.bookingId })}
            size="sm"
            className="text-danger"
            successMessage="Бронь отменена"
            confirm={{
              title: "Отменить бронь?",
              description:
                "Ученик получит уведомление, а его заявка в листе ожидания встанет в начало очереди.",
              actionLabel: "Отменить",
            }}
          >
            Отменить
          </ActionButton>
        </div>
      </CardContent>
    </Card>
  );
}

/** /interviewer/bookings (spec 8.4): сегодня и неделя. */
export default async function InterviewerBookingsPage() {
  const { user } = await requireInterviewerZone();
  const { today, week } = await getInterviewerBookings(prisma, {
    interviewerId: user.id,
    timezone: user.timezone,
    now: new Date(),
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[24px] font-semibold">Брони</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold">Сегодня</h2>
        {today.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarClock} title="На сегодня броней нет" />
          </Card>
        ) : (
          today.map((row) => <BookingCard key={row.bookingId} row={row} timezone={user.timezone} />)
        )}
      </section>

      {week.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">На неделе</h2>
          {week.map((row) => (
            <BookingCard key={row.bookingId} row={row} timezone={user.timezone} />
          ))}
        </section>
      )}
    </div>
  );
}
