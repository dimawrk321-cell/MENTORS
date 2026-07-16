import type { PrismaClient } from "@prisma/client";
import { processWaitlistHolds } from "@/lib/services/mocks";

// Джоба waitlistHolds (spec 7.15): каждые 10 мин — истечение hold-предложений
// (offer_expires_at прошло) → слот предлагается следующему в очереди; заявки,
// просроченные по until_date → expired (spec 7.8). Идемпотентна.
//
// TODO(stage 9): node-cron-обвязка (worker/index.ts) по расписанию «каждые 10 мин».
export async function runWaitlistHoldsJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ lapsed: number; expired: number }> {
  return processWaitlistHolds(db, now);
}
