import { prisma } from "@/lib/db";
import { runStreakProcessJob } from "@/worker/jobs/streak-process";

// Worker-процесс (spec 3/7.15): отдельный node-cron-процесс для фоновых задач —
// дайджесты, мониторы, генерация слотов, обработка серий. Полная обвязка и
// расписания — этап 9; здесь заведён реестр джоб с единственной заглушкой
// этапа 5 (streakProcess), чтобы точка интеграции существовала заранее.
//
// TODO(stage 9): зарегистрировать node-cron по расписаниям spec 7.15
// (slotsGenerate 02:00, streakProcess каждые 30 мин, digest каждые 15 мин,
// expiryNotify 09:00, youtubeCheck 04:00, waitlistHolds каждые 10 мин,
// sessionCleanup 05:00, linkRotationReminder 1-е число) и запустить процесс.
export const jobs = {
  /** spec 7.15: каждые 30 мин. */
  streakProcess: () => runStreakProcessJob(prisma),
};
