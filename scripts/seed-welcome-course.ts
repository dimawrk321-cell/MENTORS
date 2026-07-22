import { prisma } from "@/lib/db";
import { ensureWelcomeCourse, pinWelcomeFirstInTracks } from "@/lib/services/welcome-course";

// Thin CLI wrapper (walk 12.3 P4). Since walk 13.2 block 4 the welcome course is
// part of the main seed (prisma/seed.ts); this script remains for one-off runs
// against an existing DB (e.g. the stand) with a --dry-run preview.
//
// Run:  pnpm exec tsx scripts/seed-welcome-course.ts [--dry-run]

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const welcomeId = await ensureWelcomeCourse(prisma, dryRun);
  console.log(`Треки (${dryRun ? "предпросмотр" : "обновление"} course_ids):`);
  await pinWelcomeFirstInTracks(prisma, welcomeId, dryRun);

  console.log(
    dryRun
      ? "\n[dry-run] Ничего не записано. Для применения запусти без --dry-run."
      : "\nГотово. Курс создан как черновик — опубликуй его после вычитки в /admin/content.",
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
