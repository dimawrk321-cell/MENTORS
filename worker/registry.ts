import type { PrismaClient } from "@prisma/client";
import { runSlotsGenerateJob } from "@/worker/jobs/slots-generate";
import { runStreakProcessJob } from "@/worker/jobs/streak-process";
import { runWaitlistHoldsJob } from "@/worker/jobs/waitlist-holds";
import { runDigestJob } from "@/worker/jobs/digest";
import { runStreakRiskJob } from "@/worker/jobs/streak-risk";
import { runExpiryNotifyJob } from "@/worker/jobs/expiry-notify";
import { runYoutubeCheckJob } from "@/worker/jobs/youtube-check";
import { runSessionCleanupJob } from "@/worker/jobs/session-cleanup";
import { runLinkRotationReminderJob } from "@/worker/jobs/link-rotation-reminder";
import { runMockRemindersJob } from "@/worker/jobs/mock-reminders";
import { runEmailDispatchJob } from "@/worker/jobs/email-dispatch";

// Job registry (spec 7.15). Schedules are cron expressions in UTC (spec task:
// «Кроны — в UTC, пер-пользовательская логика — в TZ пользователя»); each job
// resolves per-user time zones internally. Shared by the worker (node-cron) and
// the /api/cron/[job] external-trigger route.

export interface JobDef {
  name: string;
  /** node-cron expression, interpreted in UTC. */
  schedule: string;
  run: (db: PrismaClient, now?: Date) => Promise<unknown>;
}

export const JOBS: JobDef[] = [
  { name: "slotsGenerate", schedule: "0 2 * * *", run: (db, now) => runSlotsGenerateJob(db, now) },
  {
    name: "streakProcess",
    schedule: "*/30 * * * *",
    run: (db, now) => runStreakProcessJob(db, now),
  },
  { name: "streakRisk", schedule: "*/30 * * * *", run: (db, now) => runStreakRiskJob(db, now) },
  { name: "digest", schedule: "*/15 * * * *", run: (db, now) => runDigestJob(db, now) },
  {
    name: "mockReminders",
    schedule: "*/15 * * * *",
    run: (db, now) => runMockRemindersJob(db, now),
  },
  { name: "expiryNotify", schedule: "0 9 * * *", run: (db, now) => runExpiryNotifyJob(db, now) },
  {
    name: "youtubeCheck",
    schedule: "0 4 * * *",
    run: (db, now) => runYoutubeCheckJob(db, { now }),
  },
  {
    name: "waitlistHolds",
    schedule: "*/10 * * * *",
    run: (db, now) => runWaitlistHoldsJob(db, now),
  },
  {
    name: "sessionCleanup",
    schedule: "0 5 * * *",
    run: (db, now) => runSessionCleanupJob(db, now),
  },
  {
    name: "linkRotationReminder",
    schedule: "0 0 1 * *",
    run: (db, now) => runLinkRotationReminderJob(db, now),
  },
  {
    name: "emailDispatch",
    schedule: "*/2 * * * *",
    run: (db, now) => runEmailDispatchJob(db, now),
  },
];

export const JOB_MAP = new Map(JOBS.map((job) => [job.name, job]));
