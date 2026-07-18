"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HBarRow } from "@/components/features/analytics-charts";
import { Badge } from "@/components/ui/badge";
import { categoryColorVar } from "@/lib/utils/category-color";
import { formatDateRu, formatDateTimeRu } from "@/lib/utils/dates";
import {
  BOOKING_STATUS_LABEL,
  MOCK_TYPE_LABEL,
  MOCK_VERDICT_LABEL,
  STRIKE_REASON_LABEL,
} from "@/lib/constants";
import type {
  CourseProgress,
  StudentEventRow,
  StudentMockHistory,
  StudentReviewSummary,
  TestAttemptRow,
} from "@/lib/services/admin-student";

interface SentNotification {
  id: string;
  type: string;
  title: string;
  inApp: boolean;
  readAt: Date | null;
  emailPending: boolean;
  emailSentAt: Date | null;
  createdAt: Date;
}

const TEST_KIND_LABEL: Record<string, string> = { module: "Модуль", testout: "Экстерн" };
const TAB_VALUES = ["progress", "tests", "reviews", "mocks", "notifications", "events"];

export function StudentTabs({
  progress,
  testAttempts,
  review,
  mocks,
  notifications,
  events,
  timezone,
  defaultTab,
}: {
  progress: CourseProgress[];
  testAttempts: TestAttemptRow[];
  review: StudentReviewSummary;
  mocks: StudentMockHistory;
  notifications: SentNotification[];
  events: StudentEventRow[];
  timezone: string;
  defaultTab: string;
}) {
  const initial = TAB_VALUES.includes(defaultTab) ? defaultTab : "progress";

  return (
    <Tabs defaultValue={initial}>
      <TabsList className="overflow-x-auto">
        <TabsTrigger value="progress">Прогресс</TabsTrigger>
        <TabsTrigger value="tests">Тесты</TabsTrigger>
        <TabsTrigger value="reviews">Повторения</TabsTrigger>
        <TabsTrigger value="mocks">Моки</TabsTrigger>
        <TabsTrigger value="notifications">Уведомления</TabsTrigger>
        <TabsTrigger value="events">События</TabsTrigger>
      </TabsList>

      {/* Прогресс */}
      <TabsContent value="progress">
        {progress.length === 0 ? (
          <Empty>Нет опубликованных курсов.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            {progress.map((course) => (
              <div key={course.id} className="flex flex-col gap-2">
                <HBarRow
                  label={course.title}
                  pct={course.pct}
                  valueText={`${course.completed}/${course.total} · ${course.pct}%`}
                />
                <ul className="text-text-3 ml-4 flex flex-col gap-0.5 text-[12px]">
                  {course.modules.map((m) => (
                    <li key={m.id} className="flex justify-between gap-3">
                      <span className="truncate">{m.title}</span>
                      <span className="shrink-0 tabular-nums">
                        {m.completed}/{m.total}
                      </span>
                    </li>
                  ))}
                  {course.lastActivityAt && (
                    <li className="text-text-3 mt-0.5">
                      последняя активность {formatDateRu(course.lastActivityAt, timezone)}
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      {/* Тесты */}
      <TabsContent value="tests">
        {testAttempts.length === 0 ? (
          <Empty>Попыток тестов ещё не было.</Empty>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {testAttempts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <span className="text-[14px]">{a.moduleTitle}</span>
                  <span className="text-text-3 ml-2 text-[12px]">
                    {a.courseTitle} · {TEST_KIND_LABEL[a.kind] ?? a.kind}
                  </span>
                </div>
                {a.finished ? (
                  <Badge variant={a.passed ? "success" : "danger"}>
                    {a.score}% {a.passed ? "· сдан" : "· провал"}
                  </Badge>
                ) : (
                  <Badge>не завершён</Badge>
                )}
                <span className="text-text-3 text-[12px]">
                  {formatDateTimeRu(a.finishedAt ?? a.startedAt, timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      {/* Повторения */}
      <TabsContent value="reviews">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Отвечено карточек" value={String(review.stats.answeredTotal)} />
            <Stat label="Выучено" value={String(review.stats.learnedCount)} />
            <Stat
              label="Точность 30 дней"
              value={
                review.stats.accuracy30 === null
                  ? "—"
                  : `${Math.round(review.stats.accuracy30 * 100)}%`
              }
            />
          </div>
          <div>
            <p className="text-text-2 mb-2 text-[13px] font-medium">
              Западающие категории (30 дней)
            </p>
            {review.lagging.length === 0 ? (
              <Empty>Пока мало повторений.</Empty>
            ) : (
              <div className="flex flex-col gap-2.5">
                {review.lagging.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: categoryColorVar(c.colorIndex) }}
                      aria-hidden="true"
                    />
                    <HBarRow
                      label={c.title}
                      pct={c.againRate * 100}
                      tone="warning"
                      valueText={`${Math.round(c.againRate * 100)}% · ${c.total}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </TabsContent>

      {/* Моки */}
      <TabsContent value="mocks">
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-text-2 mb-2 text-[13px] font-medium">История</p>
            {mocks.bookings.length === 0 ? (
              <Empty>Броней не было.</Empty>
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {mocks.bookings.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <div className="min-w-0 flex-1">
                      <span className="text-[14px]">
                        {MOCK_TYPE_LABEL[b.type] ?? b.type} · {b.interviewerName}
                      </span>
                      <span className="text-text-3 block text-[12px]">
                        {formatDateTimeRu(b.startsAt, timezone)}
                      </span>
                    </div>
                    <Badge>{BOOKING_STATUS_LABEL[b.status] ?? b.status}</Badge>
                    {b.verdict && <Badge variant="accent">{MOCK_VERDICT_LABEL[b.verdict]}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {mocks.strikes.length > 0 && (
            <div>
              <p className="text-text-2 mb-2 text-[13px] font-medium">Страйки</p>
              <ul className="flex flex-col gap-1">
                {mocks.strikes.map((s) => (
                  <li key={s.id} className="text-text-2 flex justify-between gap-3 text-[13px]">
                    <span>{STRIKE_REASON_LABEL[s.reason] ?? s.reason}</span>
                    <span className="text-text-3">{formatDateTimeRu(s.createdAt, timezone)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </TabsContent>

      {/* Уведомления */}
      <TabsContent value="notifications">
        {notifications.length === 0 ? (
          <Empty>Пока не было уведомлений.</Empty>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {notifications.map((n) => {
              const channels: string[] = [];
              if (n.inApp)
                channels.push(
                  n.readAt ? "в приложении · прочитано" : "в приложении · не прочитано",
                );
              if (n.emailSentAt)
                channels.push(`почта · отправлено ${formatDateTimeRu(n.emailSentAt, timezone)}`);
              else if (n.emailPending) channels.push("почта · в очереди");
              return (
                <li
                  key={n.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
                >
                  <div className="min-w-0">
                    <span className="text-[14px]">{n.title}</span>
                    <span className="text-text-3 ml-2 text-[12px]">{n.type}</span>
                    <span className="text-text-3 block text-[12px]">
                      {channels.join(" · ") || "нет активных каналов"}
                    </span>
                  </div>
                  <span className="text-text-3 text-[12px]">
                    {formatDateTimeRu(n.createdAt, timezone)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </TabsContent>

      {/* События */}
      <TabsContent value="events">
        {events.length === 0 ? (
          <Empty>Событий ещё нет.</Empty>
        ) : (
          <ul className="divide-border flex flex-col divide-y">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5"
              >
                <span className="font-mono text-[12px]">{e.type}</span>
                <span className="text-text-3 text-[12px]">
                  {formatDateTimeRu(e.createdAt, timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-text-3 py-6 text-center text-[14px]">{children}</p>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border-border flex flex-col gap-0.5 border p-3">
      <span className="text-text-3 text-[12px]">{label}</span>
      <span className="text-[18px] font-semibold">{value}</span>
    </div>
  );
}
