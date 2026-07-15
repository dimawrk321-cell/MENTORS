import type { PrismaClient } from "@prisma/client";
import { processStreakDay } from "@/lib/services/streak";

// Джоба streakProcess (spec 7.15): каждые 30 мин обрабатывает пользователей, у
// кого локально «прошла полночь» — заморозка/обнуление вчерашнего дня (spec 7.7).
// Ядро — тот же ленивый processStreakDay, что срабатывает при первом визите нового
// дня, поэтому джоба идемпотентна и лишь гарантирует обработку без входа в систему.
//
// TODO(stage 9): node-cron-обвязка (worker/index.ts), выборка пользователей по
// «наступившей полуночи» в их TZ вместо полного прохода, лог в stdout.
export async function runStreakProcessJob(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const users = await db.user.findMany({
    where: { role: "student", status: "active" },
    select: { id: true },
  });
  for (const user of users) {
    await processStreakDay(db, { userId: user.id, now });
  }
  return users.length;
}
