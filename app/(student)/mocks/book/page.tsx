import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, Shuffle, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  getAvailableSlots,
  getMocksPageData,
  listBookableInterviewers,
} from "@/lib/services/mock-queries";
import { MOCK_TYPE_LABEL } from "@/lib/constants";
import { formatDateRu, formatDateTimeRu } from "@/lib/utils/dates";
import { categoryColorVar } from "@/lib/utils/category-color";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SlotPicker } from "@/components/features/slot-picker";
import { ConfirmBookButton, JoinWaitlistButton } from "@/components/features/mock-actions";

export const metadata: Metadata = {
  title: "Забронировать мок",
};

type MockTypeKey = "theory" | "legend";

function isMockType(value: string | undefined): value is MockTypeKey {
  return value === "theory" || value === "legend";
}

interface BookPageProps {
  searchParams: Promise<{ type?: string; interviewer?: string; slot?: string }>;
}

function StepBack({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-text-2 hover:text-text-1 inline-flex items-center gap-1.5 text-[13px]"
    >
      <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Link>
  );
}

function Avatar({ name, color }: { name: string; color: number }) {
  return (
    <div
      className="rounded-pill flex size-10 shrink-0 items-center justify-center text-[15px] font-semibold"
      style={{
        color: categoryColorVar(color),
        background: `color-mix(in srgb, ${categoryColorVar(color)} 14%, transparent)`,
      }}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/** /mocks/book (spec 7.8/8.3): URL-мастер тип → интервьюер → слот → подтверждение. */
export default async function BookMockPage({ searchParams }: BookPageProps) {
  const { user } = await requireStudentZone();
  const sp = await searchParams;
  const now = new Date();

  // Гейты «одна активная бронь» и «лок за страйки» (spec 7.8) — до мастера.
  const state = await getMocksPageData(prisma, user.id, now);
  if (state.lock) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[24px] font-semibold">Забронировать мок</h1>
        <EmptyState
          title="Бронирование пока недоступно"
          description={`Из-за страйков бронирование закрыто до ${formatDateRu(state.lock.lockedUntil, user.timezone)}.`}
          action={
            <Button asChild variant="secondary">
              <Link href="/mocks">К мокам</Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (state.activeBooking) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[24px] font-semibold">Забронировать мок</h1>
        <EmptyState
          title="У тебя уже есть активная бронь"
          description="Можно держать только одну бронь. Заверши или отмени текущую, чтобы записаться снова."
          action={
            <Button asChild variant="secondary">
              <Link href={`/mocks/${state.activeBooking.bookingId}`}>Открыть бронь</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const type = isMockType(sp.type) ? sp.type : null;

  // Шаг 1 — тип мока.
  if (!type) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[24px] font-semibold">Какой мок бронируем?</h1>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["theory", "legend"] as const).map((t) => (
            <Link key={t} href={`/mocks/book?type=${t}`} className="group">
              <Card interactive className="h-full">
                <CardContent className="flex items-center justify-between">
                  <span className="group-hover:text-accent text-[16px] font-semibold">
                    {MOCK_TYPE_LABEL[t]}
                  </span>
                  <ArrowRight size={16} strokeWidth={1.75} className="text-text-3" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  const interviewer = sp.interviewer ?? null;

  // Шаг 2 — интервьюер или «Первый свободный».
  if (!interviewer) {
    const interviewers = await listBookableInterviewers(prisma, now);
    return (
      <div className="flex flex-col gap-5">
        <StepBack href="/mocks/book" label="Тип мока" />
        <h1 className="text-[24px] font-semibold">Выбери интервьюера</h1>
        <div className="flex flex-col gap-3">
          <Link href={`/mocks/book?type=${type}&interviewer=any`} className="group">
            <Card interactive>
              <CardContent className="flex items-center gap-4">
                <div className="rounded-pill bg-accent/12 text-accent flex size-10 shrink-0 items-center justify-center">
                  <Shuffle size={18} strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="group-hover:text-accent text-[15px] font-semibold">
                    Первый свободный
                  </p>
                  <p className="text-text-2 text-[13px]">
                    Объединённый календарь всех интервьюеров
                  </p>
                </div>
                <ArrowRight size={16} strokeWidth={1.75} className="text-text-3" />
              </CardContent>
            </Card>
          </Link>

          {interviewers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Интервьюеры пока не настроили расписание"
              description="Загляни позже — окна появятся здесь"
            />
          ) : (
            interviewers.map((card) => (
              <Link
                key={card.userId}
                href={`/mocks/book?type=${type}&interviewer=${card.userId}`}
                className="group"
              >
                <Card interactive>
                  <CardContent className="flex items-center gap-4">
                    <Avatar name={card.name} color={card.avatarColor} />
                    <div className="min-w-0 flex-1">
                      <p className="group-hover:text-accent text-[15px] font-semibold">
                        {card.name}
                      </p>
                      {card.bio ? (
                        <p className="text-text-2 line-clamp-2 text-[13px]">{card.bio}</p>
                      ) : (
                        <p className="text-text-3 text-[13px]">
                          {card.hasSlots ? "Есть свободные окна" : "Свободных окон пока нет"}
                        </p>
                      )}
                    </div>
                    <ArrowRight size={16} strokeWidth={1.75} className="text-text-3" />
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    );
  }

  const interviewerId = interviewer === "any" ? null : interviewer;

  // Шаг 4 — подтверждение (выбран конкретный слот).
  if (sp.slot) {
    const slot = await prisma.slot.findUnique({
      where: { id: sp.slot },
      include: { interviewer: { select: { name: true } } },
    });
    const valid =
      slot &&
      slot.status === "open" &&
      slot.startsAt > now &&
      (!user.accessUntil || slot.startsAt <= user.accessUntil) &&
      (interviewerId === null || slot.interviewerId === interviewerId);

    if (!valid || !slot) {
      return (
        <div className="flex flex-col gap-4">
          <StepBack
            href={`/mocks/book?type=${type}&interviewer=${interviewer}`}
            label="Выбор слота"
          />
          <EmptyState
            title="Слот уже недоступен"
            description="Похоже, его только что заняли. Выбери другое время."
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-5">
        <StepBack
          href={`/mocks/book?type=${type}&interviewer=${interviewer}`}
          label="Выбор слота"
        />
        <h1 className="text-[24px] font-semibold">Подтверждение</h1>
        <Card>
          <CardContent className="flex flex-col gap-2">
            <div className="flex justify-between gap-3">
              <span className="text-text-3 text-[13px]">Тип</span>
              <span className="text-[14px] font-medium">{MOCK_TYPE_LABEL[type]}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-text-3 text-[13px]">Интервьюер</span>
              <span className="text-[14px] font-medium">{slot.interviewer.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-text-3 text-[13px]">Время</span>
              <span className="text-[14px] font-medium">
                {formatDateTimeRu(slot.startsAt, user.timezone)}
              </span>
            </div>
          </CardContent>
        </Card>
        <p className="text-text-2 text-[13px]">
          Отмена бесплатна за 24 часа до старта. Позже — страйк. Неявка — страйк.
        </p>
        <div>
          <ConfirmBookButton slotId={slot.id} type={type} />
        </div>
      </div>
    );
  }

  // Шаг 3 — выбор слота (SlotPicker).
  const slots = await getAvailableSlots(prisma, {
    studentId: user.id,
    type,
    interviewerId,
    now,
  });

  return (
    <div className="flex flex-col gap-5">
      <StepBack href={`/mocks/book?type=${type}`} label="Интервьюер" />
      <div className="flex items-center gap-2">
        <CalendarClock size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        <h1 className="text-[24px] font-semibold">Выбери время</h1>
      </div>
      <SlotPicker
        days={slots.days}
        showInterviewer={interviewerId === null}
        hrefForSlot={(slotId) =>
          `/mocks/book?type=${type}&interviewer=${interviewer}&slot=${slotId}`
        }
      />
      <div className="border-border flex flex-col gap-2 border-t pt-4">
        <p className="text-text-3 text-[13px]">Не нашёл удобное время?</p>
        <div>
          <JoinWaitlistButton type={type} interviewerId={interviewerId} />
        </div>
      </div>
    </div>
  );
}
