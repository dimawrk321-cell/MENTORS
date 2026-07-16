import type { PrismaClient } from "@prisma/client";
import { generateAllSlots } from "@/lib/services/slots";

// Джоба slotsGenerate (spec 7.15): 02:00 ежедневно — материализация слотов всех
// интервьюеров на 14 дней вперёд (spec 7.8). Ядро — идемпотентный generateSlots,
// который также вызывается при сохранении правил/исключений в кабинете интервьюера,
// поэтому джоба лишь гарантирует ежедневное «докатывание» горизонта без ручных правок.
//
// TODO(stage 9): node-cron-обвязка (worker/index.ts) по расписанию 02:00, лог в stdout.
export async function runSlotsGenerateJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  return generateAllSlots(db, now);
}
