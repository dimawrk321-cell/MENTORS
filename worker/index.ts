import { prisma } from "@/lib/db";
import { runStreakProcessJob } from "@/worker/jobs/streak-process";
import { runSlotsGenerateJob } from "@/worker/jobs/slots-generate";
import { runWaitlistHoldsJob } from "@/worker/jobs/waitlist-holds";

// Worker-процесс (spec 3/7.15): отдельный node-cron-процесс для фоновых задач —
// дайджесты, мониторы, генерация слотов, обработка серий. Полная обвязка и
// расписания — этап 9; здесь заведён реестр джоб с заглушками (streakProcess —
// этап 5; slotsGenerate + waitlistHolds — этап 6), чтобы точки интеграции
// существовали заранее.
//
// TODO(stage 9): зарегистрировать node-cron по расписаниям spec 7.15
// (slotsGenerate 02:00, streakProcess каждые 30 мин, digest каждые 15 мин,
// expiryNotify 09:00, youtubeCheck 04:00, waitlistHolds каждые 10 мин,
// sessionCleanup 05:00, linkRotationReminder 1-е число) и запустить процесс.
export const jobs = {
  /** spec 7.15: каждые 30 мин. */
  streakProcess: () => runStreakProcessJob(prisma),
  /** spec 7.15: 02:00 ежедневно — материализация слотов на 14 дней. */
  slotsGenerate: () => runSlotsGenerateJob(prisma),
  /** spec 7.15: каждые 10 мин — истечение hold-предложений waitlist. */
  waitlistHolds: () => runWaitlistHoldsJob(prisma),
};
