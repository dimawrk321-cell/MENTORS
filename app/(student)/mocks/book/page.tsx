import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarClock, Shuffle, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import {
  getAvailableSlots,
  getMocksPageData,
  listBookableInterviewers,
  type SlotChip,
  type SlotDay,
} from "@/lib/services/mock-queries";
import { BOOKING_RULES_LINE, CANCEL_FREE_HOURS, MOCK_TYPE_LABEL } from "@/lib/constants";
import {
  formatDateRu,
  formatDateTimeRu,
  formatDayHeadingRu,
  formatTimeRu,
  localDateStr,
} from "@/lib/utils/dates";
import { categoryColorVar, categoryTextColor } from "@/lib/utils/category-color";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SlotPicker } from "@/components/features/slot-picker";
import {
  ConfirmBookButton,
  JoinWaitlistButton,
  TransferConfirmButton,
} from "@/components/features/mock-actions";

export const metadata: Metadata = {
  title: "Забронировать мок",
};

const HOUR_MS = 60 * 60 * 1000;

type MockTypeKey = "theory" | "legend";

function isMockType(value: string | undefined): value is MockTypeKey {
  return value === "theory" || value === "legend";
}

interface BookPageProps {
  searchParams: Promise<{
    type?: string;
    interviewer?: string;
    slot?: string;
    /** Перенос (13.4 block 3): id переносимой брони. */
    reschedule?: string;
  }>;
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
        color: categoryTextColor(color),
        background: `color-mix(in srgb, ${categoryColorVar(color)} 14%, transparent)`,
      }}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/** Вставляет текущий слот ученика (перенос) в дни SlotPicker как маркер «ваша бронь». */
function injectCurrentSlot(days: SlotDay[], marker: SlotChip, timezone: string): SlotDay[] {
  const dateStr = localDateStr(marker.startsAt, timezone);
  const index = days.findIndex((d) => d.dateStr === dateStr);
  if (index >= 0) {
    const chips = [...days[index]!.chips, marker].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    const copy = [...days];
    copy[index] = { ...days[index]!, chips };
    return copy;
  }
  const newDay: SlotDay = {
    dateStr,
    heading: formatDayHeadingRu(marker.startsAt, timezone),
    chips: [marker],
  };
  return [...days, newDay].sort((a, b) => (a.dateStr < b.dateStr ? -1 : 1));
}

/** /mocks/book (spec 7.8/8.3): URL-мастер тип → интервьюер → слот → подтверждение.
 *  Режим переноса (?reschedule=<id>, 13.4 block 3): тип фиксирован, финальный шаг —
 *  атомарный перенос вместо новой брони. */
export default async function BookMockPage({ searchParams }: BookPageProps) {
  const { user } = await requireStudentZone();
  const sp = await searchParams;
  const now = new Date();

  // --- Режим переноса: «Перенести» на карточке брони ведёт сюда (13.4 block 3) ---
  const rescheduleId = sp.reschedule ?? null;
  const isReschedule = rescheduleId !== null;
  const rescheduleBooking = rescheduleId
    ? await prisma.booking.findUnique({
        where: { id: rescheduleId },
        include: { slot: { include: { interviewer: { select: { name: true } } } } },
      })
    : null;

  if (isReschedule) {
    const valid =
      rescheduleBooking &&
      rescheduleBooking.userId === user.id &&
      rescheduleBooking.status === "booked" &&
      rescheduleBooking.slot.startsAt > now;
    if (!valid) {
      return (
        <div className="flex flex-col gap-4">
          <StepBack href="/mocks/mine" label="Мои моки" />
          <h1 className="text-[24px] font-semibold">Перенести мок</h1>
          <EmptyState
            title="Бронь для переноса недоступна"
            description="Возможно, она уже прошла или была отменена — открой список моих моков."
          />
        </div>
      );
    }
  }

  const heading = isReschedule ? "Перенести мок" : "Забронировать мок";

  // Гейты: лок за страйки — общий; «одна активная бронь» — только для новой брони
  // (при переносе активная бронь и есть та, что переносим) (spec 7.8/13.4 block 3.2).
  const state = await getMocksPageData(prisma, user.id, now);
  if (state.lock) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[24px] font-semibold">{heading}</h1>
        <EmptyState
          title={isReschedule ? "Перенос пока недоступен" : "Бронирование пока недоступно"}
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
  if (!isReschedule && state.activeBooking) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[24px] font-semibold">Забронировать мок</h1>
        <EmptyState
          title="У тебя уже есть активная бронь"
          description="Можно держать только одну бронь. Заверши или отмени текущую, чтобы записаться снова. Чтобы сменить время — нажми «Перенести» на карточке брони."
          action={
            <Button asChild variant="secondary">
              <Link href={`/mocks/${state.activeBooking.bookingId}`}>Открыть бронь</Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Тип: при переносе фиксирован типом переносимой брони (шаг 1 пропускается).
  const type: MockTypeKey | null = isReschedule
    ? rescheduleBooking!.type
    : isMockType(sp.type)
      ? sp.type
      : null;

  // Суффикс reschedule для всех ссылок мастера.
  const rs = isReschedule ? `&reschedule=${rescheduleId}` : "";

  // Шаг 1 — тип мока (только при обычной брони).
  if (!type) {
    return (
      <div className="flex flex-col gap-6">
        {/* D4 (spec 13.1): step 1 back to the mocks hub (was the only step with no back). */}
        <StepBack href="/mocks" label="Моки" />
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
        <StepBack
          href={isReschedule ? `/mocks/${rescheduleId}` : "/mocks/book"}
          label={isReschedule ? "К броне" : "Тип мока"}
        />
        <h1 className="text-[24px] font-semibold">
          {isReschedule ? "Куда переносим?" : "Выбери интервьюера"}
        </h1>
        <div className="flex flex-col gap-3">
          <Link href={`/mocks/book?type=${type}&interviewer=any${rs}`} className="group">
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
                href={`/mocks/book?type=${type}&interviewer=${card.userId}${rs}`}
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
      (interviewerId === null || slot.interviewerId === interviewerId) &&
      // При переносе нельзя выбрать тот же слот.
      (!isReschedule || slot.id !== rescheduleBooking!.slotId);

    if (!valid || !slot) {
      return (
        <div className="flex flex-col gap-4">
          <StepBack
            href={`/mocks/book?type=${type}&interviewer=${interviewer}${rs}`}
            label="Выбор слота"
          />
          <EmptyState
            title="Слот уже недоступен"
            description="Похоже, его только что заняли. Выбери другое время."
          />
        </div>
      );
    }

    // Перенос: подтверждение «Заменить бронь {старая} на {новая}?» + предупреждение <24ч.
    if (isReschedule) {
      const oldStartsAt = rescheduleBooking!.slot.startsAt;
      const oldWhen = formatDateTimeRu(oldStartsAt, user.timezone);
      const newWhen = formatDateTimeRu(slot.startsAt, user.timezone);
      const late = oldStartsAt.getTime() - now.getTime() < CANCEL_FREE_HOURS * HOUR_MS;
      return (
        <div className="flex flex-col gap-5">
          <StepBack
            href={`/mocks/book?type=${type}&interviewer=${interviewer}${rs}`}
            label="Выбор слота"
          />
          <h1 className="text-[24px] font-semibold">Перенести мок</h1>
          <Card>
            <CardContent className="flex flex-col gap-2">
              <div className="flex justify-between gap-3">
                <span className="text-text-3 text-[13px]">Текущая бронь</span>
                <span className="text-text-2 text-[14px] font-medium line-through">{oldWhen}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-text-3 text-[13px]">Новое время</span>
                <span className="text-[14px] font-medium">{newWhen}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-text-3 text-[13px]">Интервьюер</span>
                <span className="text-[14px] font-medium">{slot.interviewer.name}</span>
              </div>
            </CardContent>
          </Card>
          <p className="text-[14px]">
            Заменить бронь {oldWhen} на {newWhen}?
          </p>
          {late && (
            <p
              className="rounded-control border-l-2 px-3 py-2 text-[13px]"
              style={{
                color: "var(--warning)",
                borderColor: "var(--warning)",
                background: "color-mix(in srgb, var(--warning) 8%, transparent)",
              }}
            >
              Перенос менее чем за 24 часа засчитает страйк.
            </p>
          )}
          <div>
            <TransferConfirmButton bookingId={rescheduleId!} slotId={slot.id} />
          </div>
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
        <p className="text-text-2 text-[13px]">{BOOKING_RULES_LINE}</p>
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

  // Перенос: подсветить текущий слот «ваша бронь» (если он у выбранного интервьюера
  // или в объединённом календаре «Первый свободный») — недоступен для выбора.
  let days = slots.days;
  if (isReschedule) {
    const oldSlot = rescheduleBooking!.slot;
    if (interviewerId === null || interviewerId === oldSlot.interviewerId) {
      const marker: SlotChip = {
        slotId: oldSlot.id,
        startsAt: oldSlot.startsAt,
        timeLabel: formatTimeRu(oldSlot.startsAt, user.timezone),
        interviewerName: oldSlot.interviewer.name,
        current: true,
      };
      days = injectCurrentSlot(days, marker, user.timezone);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <StepBack
        href={isReschedule ? `/mocks/book?type=${type}${rs}` : `/mocks/book?type=${type}`}
        label="Интервьюер"
      />
      <div className="flex items-center gap-2">
        <CalendarClock size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        <h1 className="text-[24px] font-semibold">
          {isReschedule ? "Новое время" : "Выбери время"}
        </h1>
      </div>
      <SlotPicker
        days={days}
        showInterviewer={interviewerId === null}
        hrefForSlot={(slotId) =>
          `/mocks/book?type=${type}&interviewer=${interviewer}&slot=${slotId}${rs}`
        }
      />
      {!isReschedule && (
        <div className="border-border flex flex-col gap-2 border-t pt-4">
          <p className="text-text-3 text-[13px]">Не нашёл удобное время?</p>
          <div>
            <JoinWaitlistButton type={type} interviewerId={interviewerId} />
          </div>
        </div>
      )}
    </div>
  );
}
