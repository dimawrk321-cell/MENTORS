/**
 * Dump every course's description (spec 13.1/A4) for the owner to proofread the
 * raw imported texts. Prints slug · title · status · description, one block each.
 *
 * Run against any contour (dev, or the stand via an SSH tunnel):
 *   pnpm tsx scripts/dump-course-descriptions.ts
 *   DATABASE_URL=postgresql://... pnpm tsx scripts/dump-course-descriptions.ts
 */
import { prisma } from "@/lib/db";

async function main() {
  const courses = await prisma.course.findMany({
    select: { slug: true, title: true, status: true, description: true },
    orderBy: { order: "asc" },
  });
  console.log(`# Course descriptions (${courses.length})\n`);
  for (const c of courses) {
    console.log(`## ${c.title}  [${c.slug} · ${c.status}]`);
    console.log(c.description?.trim() ? c.description.trim() : "(пусто)");
    console.log("");
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
