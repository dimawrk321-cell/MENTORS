import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getMyMocks, type MockListItem } from "@/lib/services/mocks";
import { BOOKING_STATUS_LABEL, MOCK_TYPE_LABEL, MOCK_VERDICT_LABEL } from "@/lib/constants";
import { formatDateTimeRu } from "@/lib/utils/dates";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/back-button";

export const metadata: Metadata = {
  title: "Мои моки",
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

function MockRow({ item, timezone }: { item: MockListItem; timezone: string }) {
  return (
    <li>
      <Link href={`/mocks/${item.bookingId}`} className="group block">
        <div className="ease-app hover:bg-surface-2 flex flex-wrap items-center gap-2 px-5 py-3.5 transition-colors duration-150">
          <div className="min-w-0 flex-1">
            <p className="group-hover:text-accent text-[14px] font-medium">
              {MOCK_TYPE_LABEL[item.type]} · {item.interviewerName}
            </p>
            <p className="text-text-3 text-[13px]">{formatDateTimeRu(item.startsAt, timezone)}</p>
          </div>
          <Badge variant={STATUS_VARIANT[item.status] ?? "default"}>
            {BOOKING_STATUS_LABEL[item.status]}
          </Badge>
          {item.verdict && (
            <Badge variant={VERDICT_VARIANT[item.verdict] ?? "default"}>
              {MOCK_VERDICT_LABEL[item.verdict]}
            </Badge>
          )}
        </div>
      </Link>
    </li>
  );
}

/** /mocks/mine (spec 8.3): предстоящие и история со статусами и вердиктами. */
export default async function MyMocksPage() {
  const { user } = await requireStudentZone();
  const { upcoming, history } = await getMyMocks(prisma, user.id, new Date());

  return (
    <div className="flex flex-col gap-6">
      {/* D4 (spec 13.1): missing hierarchical back added (/mocks/mine is a child of /mocks). */}
      <BackButton href="/mocks" label="Моки" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-semibold">Мои моки</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/mocks">К бронированию</Link>
        </Button>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold">Предстоящие</h2>
        {upcoming.length === 0 ? (
          <Card>
            <EmptyState
              icon={CalendarClock}
              title="Забронируй первый мок — интервьюеры уже ждут"
              action={
                <Button asChild>
                  <Link href="/mocks">Забронировать</Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <Card>
            <ul className="divide-border divide-y">
              {upcoming.map((item) => (
                <MockRow key={item.bookingId} item={item} timezone={user.timezone} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[18px] font-semibold">История</h2>
          <Card>
            <ul className="divide-border divide-y">
              {history.map((item) => (
                <MockRow key={item.bookingId} item={item} timezone={user.timezone} />
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
