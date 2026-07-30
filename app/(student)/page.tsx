import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import {
  BarChart3,
  Blocks,
  BookMarked,
  Bot,
  Braces,
  ChevronRight,
  Cpu,
  Database,
  Layers,
  Play,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getActivityBarData, getContinueTarget } from "@/lib/services/dashboard";
import { getSrsQueue, getNextReviewDate, getLaggingCategories } from "@/lib/services/srs";
import { getActiveBooking } from "@/lib/services/mocks";
import { listCoursesForStudent } from "@/lib/services/content";
import { getStreakState, processStreakDay } from "@/lib/services/streak";
import { getTodayXp, getXpSummary } from "@/lib/services/xp";
import { getLevelTitles } from "@/lib/services/settings";
import { titleForLevel } from "@/lib/services/level-titles";
import { formatDateOnlyRu, formatDateTimeRu, localDateStr, pluralRu } from "@/lib/utils/dates";
import { CategoryChip } from "@/components/features/category-chip";
import { IconTile } from "@/components/features/icon-tile";
import { ProgressRing } from "@/components/features/progress-ring";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GoalRing } from "@/components/features/goal-ring";
import { StreakBadge } from "@/components/features/streak-badge";
import { LevelBadge } from "@/components/features/level-badge";
import { ActivityBar } from "@/components/features/activity-bar";
import { MockBookingCard } from "@/components/features/mock-booking-card";

export const metadata: Metadata = {
  title: "Главная",
};

// Full gradient hero card backdrop (design handoff «Главная v2»).
const HERO_GRADIENT =
  "radial-gradient(640px 220px at 88% -30%, rgb(255 255 255 / 0.28), transparent 70%)," +
  "radial-gradient(400px 180px at 8% 120%, rgb(255 255 255 / 0.12), transparent 70%)," +
  "linear-gradient(135deg, #5e6ad2, #8b5cf6)";

// Course mini-cards have no colour/icon field — derive a category colour + icon by index.
const COURSE_ICONS: LucideIcon[] = [BarChart3, Bot, Blocks, Braces, Database, Cpu];

/** Полоса активности кешируется 60с на пользователя в сутки (spec 12: агрегаты). */
function loadActivityBar(userId: string, timezone: string, todayStr: string) {
  return unstable_cache(
    () => getActivityBarData(prisma, { userId, now: new Date(), timezone }),
    ["dashboard-activity-bar", userId, todayStr],
    { revalidate: 60 },
  )();
}

/** Дашборд (spec 8.3, design «Главная v2»): приветствие → продолжить → сегодня → курсы. */
export default async function DashboardPage() {
  const { user } = await requireStudentZone();
  const now = new Date();
  const todayStr = localDateStr(now, user.timezone);

  // Ленивый «конец дня»: разрешаем пропущенные учебные дни до первого чтения серии.
  await processStreakDay(prisma, { userId: user.id, now });

  const [streak, xp, todayXp, cont, queue, courses, lagging, activityBar, activeMock, levelTitles] =
    await Promise.all([
      getStreakState(prisma, {
        userId: user.id,
        now,
        timezone: user.timezone,
        studyDays: user.studyDays,
      }),
      getXpSummary(prisma, user.id),
      getTodayXp(prisma, user.id, now, user.timezone),
      getContinueTarget(prisma, user.id, user.track),
      getSrsQueue(prisma, { userId: user.id, now }),
      listCoursesForStudent(prisma, user.id, user.track),
      getLaggingCategories(prisma, { userId: user.id, now }),
      loadActivityBar(user.id, user.timezone, todayStr),
      getActiveBooking(prisma, user.id, now),
      getLevelTitles(prisma),
    ]);
  const nextReview =
    queue.total === 0 ? await getNextReviewDate(prisma, { userId: user.id, now }) : null;
  const levelTitle = titleForLevel(xp.level.level, levelTitles);

  const firstName = user.name.split(" ")[0] || user.name;
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: user.timezone,
  }).format(now);
  const heroPct =
    cont && cont.moduleTotal > 0 ? Math.round((cont.moduleDone / cont.moduleTotal) * 100) : 0;
  const streakInfo = { current: streak.current, freezes: streak.freezes, atRisk: streak.atRisk };
  const showLagging = lagging !== null && lagging.length > 0;

  const queueBlock =
    queue.total > 0 ? (
      <Card className="h-full">
        <CardContent className="flex h-full flex-col gap-3.5">
          <div className="flex items-center gap-3">
            <IconTile icon={Layers} colorVar="var(--accent)" />
            <div className="min-w-0 flex-1">
              <p className="text-text-3 text-[13px]">Очередь повторений</p>
              <p className="text-[17px] font-semibold">
                {queue.total} {pluralRu(queue.total, "карточка", "карточки", "карточек")} · ~
                {queue.estimateMinutes} мин
              </p>
            </div>
          </div>
          <div className="mt-auto">
            <Link
              href="/trainer/session"
              style={{ backgroundImage: "var(--gradient-accent)" }}
              className="rounded-control ease-app inline-flex h-9 items-center gap-2 px-4 text-[14px] font-medium text-white transition-transform duration-150 active:scale-[.98]"
            >
              <Play size={15} strokeWidth={1.75} aria-hidden="true" />
              Начать
            </Link>
          </div>
        </CardContent>
      </Card>
    ) : (
      <Card className="h-full">
        <EmptyState
          icon={Layers}
          title="Всё повторено"
          description={
            nextReview
              ? `Следующие карточки — ${formatDateOnlyRu(nextReview)}.`
              : "Заверши урок — его ключевые вопросы придут сюда."
          }
        />
      </Card>
    );

  const activitySection = (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Активность</h2>
      <Card>
        <CardContent className="p-[18px]">
          <ActivityBar data={activityBar} streak={streakInfo} />
        </CardContent>
      </Card>
    </section>
  );

  return (
    <div className="flex flex-col gap-7">
      {/* Приветствие: дата + h1 + стрик/уровень/XP + кольцо цели (design «Главная v2») */}
      <section className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-2.5">
          <p className="text-text-3 text-[13px]">{dateLabel}</p>
          <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.02em]">
            Привет, {firstName}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StreakBadge current={streak.current} atRisk={streak.atRisk} freezes={streak.freezes} />
            <LevelBadge
              level={xp.level.level}
              progress={xp.level.progress}
              toNext={xp.level.toNext}
              title={levelTitle}
            />
            <span className="rounded-pill bg-success/12 text-success inline-flex items-center gap-1.5 px-3 py-[5px] text-[13px] font-medium">
              <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />
              {todayXp > 0 ? `+${todayXp}` : todayXp} XP сегодня
            </span>
          </div>
        </div>
        <GoalRing value={todayXp} goal={user.dailyGoalXp} dayKey={todayStr} size={88} />
      </section>

      {/* Hero «Продолжить» — полноградиентная карточка (design «Главная v2») */}
      {cont ? (
        <div
          className="relative overflow-hidden rounded-[18px]"
          style={{
            backgroundImage: HERO_GRADIENT,
            boxShadow: "0 12px 40px color-mix(in srgb, var(--accent) 25%, transparent)",
          }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-[60px] size-[260px] rounded-full border-[32px] border-white/8"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-[120px] -bottom-[110px] size-[220px] rounded-full border-[26px] border-white/6"
          />
          <div className="relative flex flex-col gap-[18px] p-7">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-pill inline-flex items-center bg-white/16 px-2.5 py-[3px] text-[12px] font-medium text-white">
                  {cont.courseTitle}
                </span>
                <span className="truncate text-[13px] text-white/75">{cont.moduleTitle}</span>
              </div>
              <p className="text-[22px] leading-[1.3] font-bold tracking-[-0.01em] text-white">
                {cont.lessonTitle}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href={`/lessons/${cont.lessonId}`}
                className="text-accent rounded-control ease-app inline-flex h-10 items-center gap-2 bg-white px-5 text-[14px] font-semibold transition-transform duration-150 hover:-translate-y-px active:scale-[.98]"
              >
                <Play size={15} strokeWidth={1.75} aria-hidden="true" />
                {cont.mode === "continue" ? "Продолжить" : "Начать обучение"}
              </Link>
              {cont.moduleTotal > 0 && (
                <div className="flex min-w-[200px] items-center gap-2.5">
                  <span className="rounded-pill block h-1.5 flex-1 overflow-hidden bg-white/25">
                    <span
                      className="rounded-pill block h-full bg-white"
                      style={{ width: `${heroPct}%` }}
                    />
                  </span>
                  <span className="text-[12px] font-medium whitespace-nowrap text-white/85">
                    {cont.moduleDone}/{cont.moduleTotal} уроков
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="Начни с первого урока"
            description="Здесь появится твой прогресс"
            action={
              <Button asChild>
                <Link href="/courses">Открыть курсы</Link>
              </Button>
            }
          />
        </Card>
      )}

      {/* «Сегодня»: очередь + ближайший мок в две колонки (design «Главная v2») */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Сегодня</h2>
        {activeMock ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {queueBlock}
            <MockBookingCard
              bookingId={activeMock.bookingId}
              type={activeMock.type}
              interviewerName={activeMock.interviewerName}
              roomUrl={activeMock.roomUrl}
              whenLabel={formatDateTimeRu(activeMock.startsAt, user.timezone)}
              startsAtMs={activeMock.startsAt.getTime()}
              endsAtMs={activeMock.endsAt.getTime()}
            />
          </div>
        ) : (
          queueBlock
        )}
      </section>

      {/* Курсы: мини-карточки с плиткой-иконкой + кольцом прогресса (design «Главная v2») */}
      {courses.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Курсы</h2>
            <Link href="/courses" className="text-text-2 hover:text-accent text-[13px]">
              Все курсы →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course, index) => {
              const catVar = `var(--cat-${index % 8})`;
              const Icon = COURSE_ICONS[index % COURSE_ICONS.length]!;
              return (
                <Link
                  key={course.id}
                  href={`/courses/${course.slug}`}
                  className="group block min-w-0"
                >
                  <Card interactive className="h-full">
                    <CardContent className="flex items-center gap-3.5 p-[18px]">
                      <IconTile icon={Icon} colorVar={catVar} size={44} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{course.title}</p>
                        <p className="text-text-3 text-[12px]">
                          {course.lessonsCompleted} из {course.lessonsTotal}{" "}
                          {pluralRu(course.lessonsTotal, "урок", "урока", "уроков")}
                        </p>
                      </div>
                      <ProgressRing
                        pct={course.progressPct}
                        colorVar={catVar}
                        label={`Прогресс курса «${course.title}»`}
                      />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Западающие темы + Активность в две колонки (design «Главная v2») */}
      {showLagging ? (
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
          <section className="flex min-w-0 flex-col gap-3">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em]">Западающие темы</h2>
            <Card>
              <ul className="divide-border divide-y">
                {lagging.map((entry) => (
                  <li key={entry.categoryId} className="flex items-center gap-3 px-[18px] py-3.5">
                    <CategoryChip title={entry.title} colorIndex={entry.colorIndex} />
                    <span className="text-text-2 ml-auto shrink-0 text-[13px]">
                      {Math.round(entry.againShare * 100)}% «не знаю»
                    </span>
                    <Link
                      href={`/questions?category=${entry.categoryId}`}
                      className="text-accent hover:text-accent-hover shrink-0 text-[13px] font-medium"
                    >
                      Повторить
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
          {activitySection}
        </div>
      ) : (
        activitySection
      )}

      {/* Тихая карточка-вход в справочник (spec 12.2/1.3), ведёт в хаб /guides */}
      <Link href="/guides" className="group block min-w-0">
        <Card interactive>
          <CardContent className="flex items-center gap-4 px-[18px] py-4">
            <IconTile icon={BookMarked} colorVar="var(--cat-1)" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-medium">Справочник</p>
              <p className="text-text-3 truncate text-[13px]">
                {[
                  user.guidesResumeEnabled ? "Резюме" : null,
                  user.guidesLegendEnabled ? "Легенда" : null,
                  "Этапы собеседований",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <ChevronRight
              size={18}
              strokeWidth={1.75}
              className="text-text-3 group-hover:text-text-2 shrink-0"
              aria-hidden="true"
            />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
