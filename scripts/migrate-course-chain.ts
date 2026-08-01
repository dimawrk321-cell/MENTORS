/**
 * Seeds the hard course chain (walk 13.6, block 2v2.2 + 2v2.5).
 *
 * Two idempotent steps (the logic lives in lib/services/course-chain-migration.ts,
 * this file only prints):
 *
 *   1. ORDER — sets the global chain order the owner specified:
 *      welcome → Python + PyTorch → Classic ML → NLP базовый → NLP продвинутый →
 *      everything else keeping its current relative order. Only `courses.order`
 *      is written; the studio's drag-and-drop can re-shuffle it afterwards.
 *
 *   2. STUDENTS — gives existing students the access they have already earned,
 *      so nobody wakes up locked out of a course they were working in.
 *
 * Run (dry-run prints the plan and writes nothing):
 *   pnpm exec tsx scripts/migrate-course-chain.ts
 *   pnpm exec tsx scripts/migrate-course-chain.ts --commit
 *   pnpm exec tsx scripts/migrate-course-chain.ts --commit --order-only
 *
 * Against the stand, via an SSH tunnel:
 *   ssh -f -N -L 15432:127.0.0.1:5432 mentors-vps
 *   DATABASE_URL=postgresql://mentors:<pw>@127.0.0.1:15432/mentors pnpm exec tsx \
 *     scripts/migrate-course-chain.ts --commit
 */
import { prisma } from "@/lib/db";
import {
  applyChainOrder,
  migrateAllStudents,
  planChainOrder,
} from "@/lib/services/course-chain-migration";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const orderOnly = args.includes("--order-only");

async function main(): Promise<void> {
  console.log(commit ? "РЕЖИМ: запись" : "РЕЖИМ: пробный прогон (--commit чтобы записать)");

  console.log("\n1. Порядок курсов (цепь):");
  const plan = await planChainOrder(prisma);
  for (const row of plan) {
    const mark = row.from === row.to ? " " : "→";
    console.log(`  ${mark} ${String(row.to).padStart(2)}  ${row.title}  (${row.slug})`);
  }
  const willMove = plan.filter((row) => row.from !== row.to).length;
  console.log(`   позицию меняют: ${willMove} из ${plan.length}`);
  if (commit) await applyChainOrder(prisma);

  if (orderOnly) {
    await prisma.$disconnect();
    return;
  }

  console.log("\n2. Доступы существующих учеников:");
  const { reports, skipped } = await migrateAllStudents(prisma, { commit });
  for (const report of reports) {
    console.log(`  ${report.email}`);
    for (const course of report.opened) console.log(`      + ${course}`);
  }
  const totalOpened = reports.reduce((sum, r) => sum + r.opened.length, 0);
  console.log(
    `   учеников затронуто: ${reports.length} · ${commit ? "открыто" : "будет открыто"} курсов: ${totalOpened} · пропущено (не активны): ${skipped}`,
  );

  if (!commit) console.log("\nНичего не записано. Повтори с --commit.");
  await prisma.$disconnect();
}

void main();
