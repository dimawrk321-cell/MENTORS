/**
 * Seeds the hard course chain (walk 13.6, block 2v2.2 + 2v2.5).
 *
 * Two steps, run as ONE transaction (the logic lives in
 * lib/services/course-chain-migration.ts, this file only prints):
 *
 *   1. ORDER — the global chain order the owner specified: welcome → Python +
 *      PyTorch → Classic ML → NLP базовый → NLP продвинутый → everything else
 *      keeping its current relative order. Only `courses.order` is written.
 *
 *   2. STUDENTS — the access they have already earned: the chain's first link,
 *      every course with real progress, and the next link after each course they
 *      have finished (the live chain fires on the completion event, which is in
 *      the past for them).
 *
 * The dry run performs the SAME writes and rolls them back, so the preview is
 * the real thing — step 2 reads the order step 1 writes, and a simulation that
 * skipped step 1 would report a different chain than --commit produces.
 * Re-running changes nothing.
 *
 * Run:
 *   pnpm exec tsx scripts/migrate-course-chain.ts
 *   pnpm exec tsx scripts/migrate-course-chain.ts --commit
 *
 * Against the stand (server-side, so the DB password never leaves the box):
 *   ssh mentors-vps 'docker run --rm --entrypoint sh --network mentors_default \
 *     --env-file /opt/mentors/.env.prod -v /opt/mentors:/src:ro -w /app \
 *     mentors-web:latest -c "cp -r /src/lib /src/scripts /src/tsconfig.json /app/ \
 *       && ./node_modules/.bin/tsx scripts/migrate-course-chain.ts --commit"'
 */
import { prisma } from "@/lib/db";
import { runChainMigration } from "@/lib/services/course-chain-migration";

const commit = process.argv.slice(2).includes("--commit");

async function main(): Promise<void> {
  console.log(commit ? "РЕЖИМ: запись" : "РЕЖИМ: пробный прогон (--commit чтобы записать)");

  const result = await runChainMigration(prisma, { commit });

  console.log("\n1. Порядок курсов (цепь):");
  for (const row of result.plan) {
    const mark = row.from === row.to ? " " : "→";
    console.log(`  ${mark} ${String(row.to).padStart(2)}  ${row.title}  (${row.slug})`);
  }
  console.log(`   позицию меняют: ${result.moved} из ${result.plan.length}`);

  console.log("\n2. Доступы существующих учеников:");
  for (const report of result.reports) {
    console.log(`  ${report.email}`);
    for (const course of report.opened) console.log(`      + ${course}`);
  }
  const totalOpened = result.reports.reduce((sum, r) => sum + r.opened.length, 0);
  console.log(
    `   учеников затронуто: ${result.reports.length} · ${
      commit ? "открыто" : "будет открыто"
    } курсов: ${totalOpened} · без изменений: ${result.untouched}`,
  );

  if (!commit) console.log("\nНичего не записано (транзакция откачена). Повтори с --commit.");
  await prisma.$disconnect();
}

void main();
