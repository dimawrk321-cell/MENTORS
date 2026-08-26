import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getUserAchievements } from "@/lib/services/achievements";
import { getHeatmapData } from "@/lib/services/dashboard";
import { getMockScoreSummary } from "@/lib/services/feedback";
import { getMocksCompletedCount } from "@/lib/services/mocks";
import { getNotificationMatrix } from "@/lib/services/notifications";
import { getTelegramLinkStatus } from "@/lib/services/telegram/linking";
import { listCoursesForStudent } from "@/lib/services/content";
import { getLaggingCategories, getTrainerStats } from "@/lib/services/srs";
import { getStreakState, processStreakDay } from "@/lib/services/streak";
import { getTodayXp, getXpSummary } from "@/lib/services/xp";
import { getLevelTitles, getXpMap } from "@/lib/services/settings";
import { titleForLevel } from "@/lib/services/level-titles";
import { localDateStr } from "@/lib/utils/dates";
import { ProfileTabs, type ProfileTab } from "@/components/features/profile-tabs";
import { OverviewTab } from "./overview-tab";
import { ProfileHeader } from "./profile-header";
import { SettingsTab } from "./settings-tab";
import { XpTab } from "./xp-tab";

export const metadata: Metadata = { title: "Профиль" };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user, session } = await requireStudentZone();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  await processStreakDay(prisma, { userId: user.id, now });

  const [
    devices,
    achievements,
    notificationMatrix,
    xp,
    todayXp,
    levelTitles,
    telegram,
    xpMap,
    streak,
    courses,
    trainerStats,
    lagging,
    heatmap,
    mocksCompleted,
    mockScores,
    lessonsLastWeek,
    params,
  ] = await Promise.all([
    prisma.device.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" } }),
    getUserAchievements(prisma, user.id),
    getNotificationMatrix(prisma, user.id),
    getXpSummary(prisma, user.id),
    getTodayXp(prisma, user.id, now, user.timezone),
    getLevelTitles(prisma),
    getTelegramLinkStatus(prisma, user.id),
    getXpMap(prisma),
    getStreakState(prisma, {
      userId: user.id,
      now,
      timezone: user.timezone,
      studyDays: user.studyDays,
    }),
    listCoursesForStudent(prisma, user.id),
    getTrainerStats(prisma, { userId: user.id, now }),
    getLaggingCategories(prisma, { userId: user.id, now }),
    getHeatmapData(prisma, { userId: user.id, now, timezone: user.timezone, weeks: 14 }),
    getMocksCompletedCount(prisma, user.id),
    getMockScoreSummary(prisma, user.id),
    prisma.lessonProgress.count({
      where: { userId: user.id, status: "completed", completedAt: { gte: weekAgo } },
    }),
    searchParams,
  ]);

  const levelTitle = titleForLevel(xp.level.level, levelTitles);
  const nextLevelTitle = titleForLevel(xp.level.level + 1, levelTitles);
  const dayKey = localDateStr(now, user.timezone);
  // Нельзя вызывать helper из `"use client"`-модуля на сервере: Next заменяет
  // такой импорт ссылкой на клиент и падает в runtime. Разрешаем значение здесь.
  const defaultTab: ProfileTab =
    params.tab === "xp" || params.tab === "settings" ? params.tab : "overview";

  return (
    <div className="flex flex-col gap-5">
      <ProfileHeader
        name={user.name}
        email={user.email}
        since={user.createdAt}
        accessUntil={user.accessUntil}
        timezone={user.timezone}
        totalXp={xp.totalXp}
        level={xp.level}
        levelTitle={levelTitle}
        nextLevelTitle={nextLevelTitle}
        accessActive={!user.accessUntil || user.accessUntil >= now}
      />
      <ProfileTabs
        defaultTab={defaultTab}
        overview={
          <OverviewTab
            streak={streak}
            courses={courses}
            lessonsLastWeek={lessonsLastWeek}
            cards={trainerStats}
            mocks={{ completed: mocksCompleted, average: mockScores.average }}
            lagging={lagging}
            heatmap={heatmap}
            achievements={achievements}
          />
        }
        xp={
          <XpTab
            streak={streak}
            xp={xp}
            todayXp={todayXp}
            goal={user.dailyGoalXp}
            dayKey={dayKey}
            xpMap={xpMap}
            levelTitle={levelTitle}
          />
        }
        settings={
          <SettingsTab
            user={user}
            devices={devices}
            currentDeviceId={session.deviceId}
            notificationMatrix={notificationMatrix}
            telegramLinked={telegram.linked}
          />
        }
      />
    </div>
  );
}
