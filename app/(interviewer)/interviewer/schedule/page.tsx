import type { Metadata } from "next";
import { CalendarDays, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireInterviewerZone } from "@/lib/auth/guards";
import { getInterviewerProfile } from "@/lib/services/mock-admin";
import {
  effectiveWindowsForDate,
  getSchedulePreview,
  gridStartsForWindow,
  minutesToTime,
} from "@/lib/services/slots";
import { isRoomUrlReady } from "@/lib/constants";
import {
  addDays,
  dateOnlyUtc,
  formatDateOnlyRu,
  formatDayHeadingRu,
  formatTimeRu,
  isoWeekday,
  localDateStr,
} from "@/lib/utils/dates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScheduleCalendar, type CalendarDay } from "@/components/features/schedule-calendar";
import {
  AddExceptionForm,
  AddRuleForm,
  CloseDayForm,
  DeleteExceptionButton,
  DeleteRuleButton,
  ProfileForm,
} from "@/components/features/schedule-controls";

export const metadata: Metadata = {
  title: "Расписание",
};

const WEEKDAY_LABEL = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const SLOT_STATUS_LABEL: Record<string, string> = {
  open: "свободен",
  booked: "занят",
  closed: "закрыт",
};

const CALENDAR_WEEKS = 4;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[18px] font-semibold">{children}</h2>;
}

/** /interviewer/schedule (spec 8.4, 12.1/C6): профиль + вкладки «Неделя»
 *  (правила/исключения/закрыть день/предпросмотр) и «Календарь» (сетка 4 недель). */
export default async function InterviewerSchedulePage() {
  const { user } = await requireInterviewerZone();
  const now = new Date();

  const [profile, rules, exceptions, preview] = await Promise.all([
    getInterviewerProfile(prisma, user.id),
    prisma.availabilityRule.findMany({
      where: { interviewerId: user.id },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    }),
    prisma.availabilityException.findMany({
      where: { interviewerId: user.id, date: { gte: new Date(Date.now() - 86_400_000) } },
      orderBy: [{ date: "asc" }],
    }),
    getSchedulePreview(prisma, { interviewerId: user.id, timezone: user.timezone, now }),
  ]);

  const roomMissing = !isRoomUrlReady(profile?.roomUrl);

  // 4-week grid, Monday-aligned (spec 12.1/C6). Availability is computed here (the
  // slots helpers pull server-only modules) and passed to the client as plain cells.
  const todayStr = localDateStr(now, user.timezone);
  const gridStart = dateOnlyUtc(
    localDateStr(addDays(dateOnlyUtc(todayStr), -(isoWeekday(todayStr) - 1)), "UTC"),
  );
  const calendarDays: CalendarDay[] = [];
  for (let d = 0; d < CALENDAR_WEEKS * 7; d += 1) {
    const cellDate = addDays(gridStart, d);
    const dateStr = localDateStr(cellDate, "UTC");
    const weekday = isoWeekday(dateStr);
    const dayOff = exceptions.find(
      (e) => e.kind === "day_off" && localDateStr(e.date, "UTC") === dateStr,
    );
    const extras = exceptions
      .filter((e) => e.kind === "extra" && localDateStr(e.date, "UTC") === dateStr)
      .map((e) => ({ id: e.id, startTime: e.startTime ?? "", endTime: e.endTime ?? "" }));
    const recurring = rules
      .filter((r) => r.active && r.weekday === weekday)
      .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
    const slotTimes = effectiveWindowsForDate(dateStr, rules, exceptions).flatMap((w) =>
      gridStartsForWindow(w).map(minutesToTime),
    );
    calendarDays.push({
      dateStr,
      dayNum: cellDate.getUTCDate(),
      label: formatDateOnlyRu(cellDate),
      weekdayLabel: WEEKDAY_LABEL[weekday]!,
      isPast: dateStr < todayStr,
      isToday: dateStr === todayStr,
      hasRule: recurring.length > 0,
      isDayOff: !!dayOff,
      dayOffId: dayOff?.id ?? null,
      recurring,
      extras,
      slotTimes,
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[24px] font-semibold">Расписание</h1>

      {/* Баннер незаполненной комнаты (acceptance-фикс г) */}
      {roomMissing && (
        <Card className="border-l-warning border-l-2">
          <CardContent className="flex gap-3">
            <TriangleAlert size={18} strokeWidth={1.75} className="text-warning mt-0.5 shrink-0" />
            <div>
              <p className="text-[15px] font-medium">Укажи ссылку на комнату</p>
              <p className="text-text-2 mt-1 text-[13px]">
                Пока стоит плейсхолдер, ученики видят «Комната не указана» вместо кнопки
                «Подключиться». Вставь постоянную ссылку Телемоста ниже — она подтянется и в уже
                оформленные брони.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Профиль интервьюера (spec 8.4): room_url редактируется здесь. */}
      <section className="flex flex-col gap-3">
        <SectionTitle>Профиль</SectionTitle>
        <Card>
          <CardContent>
            <ProfileForm
              roomUrl={profile?.roomUrl ?? ""}
              bio={profile?.bio ?? null}
              active={profile?.active ?? true}
            />
          </CardContent>
        </Card>
      </section>

      <Tabs defaultValue="weekly">
        <TabsList>
          <TabsTrigger value="weekly">Неделя</TabsTrigger>
          <TabsTrigger value="calendar">Календарь</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly">
          <div className="flex flex-col gap-8">
            {/* Правила доступности (spec 8.4) */}
            <section className="flex flex-col gap-3">
              <SectionTitle>Повторяющиеся окна</SectionTitle>
              <Card>
                <CardContent className="flex flex-col gap-4">
                  {rules.length === 0 ? (
                    <p className="text-text-2 text-[14px]">
                      Пока нет окон. Добавь повторяющееся окно — слоты появятся автоматически.
                    </p>
                  ) : (
                    <ul className="divide-border divide-y">
                      {rules.map((rule) => (
                        <li
                          key={rule.id}
                          className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="w-10 text-[14px] font-medium">
                            {WEEKDAY_LABEL[rule.weekday]}
                          </span>
                          <span className="text-text-2 flex-1 text-[14px] tabular-nums">
                            {rule.startTime}–{rule.endTime}
                          </span>
                          <DeleteRuleButton ruleId={rule.id} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="border-border border-t pt-4">
                    <AddRuleForm />
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Исключения (spec 8.4) */}
            <section className="flex flex-col gap-3">
              <SectionTitle>Исключения</SectionTitle>
              <Card>
                <CardContent className="flex flex-col gap-4">
                  {exceptions.length === 0 ? (
                    <p className="text-text-2 text-[14px]">
                      Выходные и дополнительные окна на конкретные даты появятся здесь.
                    </p>
                  ) : (
                    <ul className="divide-border divide-y">
                      {exceptions.map((exception) => (
                        <li
                          key={exception.id}
                          className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                        >
                          <span className="text-[14px] font-medium">
                            {formatDateOnlyRu(exception.date)}
                          </span>
                          <span className="text-text-2 flex-1 text-[14px]">
                            {exception.kind === "day_off"
                              ? "Выходной"
                              : `Доп. окно ${exception.startTime}–${exception.endTime}`}
                          </span>
                          <DeleteExceptionButton exceptionId={exception.id} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="border-border border-t pt-4">
                    <AddExceptionForm />
                  </div>
                </CardContent>
              </Card>
            </section>

            {/* Закрыть день (spec 7.8/8.4) */}
            <section className="flex flex-col gap-3">
              <SectionTitle>Закрыть день</SectionTitle>
              <Card>
                <CardContent>
                  <CloseDayForm />
                </CardContent>
              </Card>
            </section>

            {/* Предпросмотр слотов на 2 недели (spec 8.4) */}
            <section className="flex flex-col gap-3">
              <SectionTitle>Слоты на 2 недели</SectionTitle>
              {preview.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={CalendarDays}
                    title="Слотов пока нет"
                    description="Добавь повторяющееся окно — слоты материализуются на 14 дней вперёд"
                  />
                </Card>
              ) : (
                <Card>
                  <CardContent className="flex flex-col gap-4">
                    {preview.map((day) => (
                      <div key={day.dateStr} className="flex flex-col gap-2">
                        <h3 className="text-text-2 text-[13px] font-medium first-letter:uppercase">
                          {formatDayHeadingRu(day.slots[0]!.startsAt, user.timezone)}
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {day.slots.map((slot) => (
                            <Badge
                              key={slot.id}
                              variant={
                                slot.status === "booked"
                                  ? "accent"
                                  : slot.status === "closed"
                                    ? "default"
                                    : "success"
                              }
                              title={SLOT_STATUS_LABEL[slot.status]}
                              className={slot.status === "closed" ? "line-through opacity-60" : ""}
                            >
                              {formatTimeRu(slot.startsAt, user.timezone)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="calendar">
          <section className="flex flex-col gap-3">
            <SectionTitle>Календарь на 4 недели</SectionTitle>
            <p className="text-text-2 text-[14px]">
              Клик по дню — окна, выходной и превью слотов. Дни с повторяющимся правилом подсвечены.
            </p>
            <Card>
              <CardContent>
                <ScheduleCalendar days={calendarDays} />
              </CardContent>
            </Card>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
