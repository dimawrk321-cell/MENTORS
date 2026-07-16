import { prisma } from "@/lib/db";
import { computeReadingMinutes } from "@/lib/utils/markdown";

// Stage 7 linkage (spec 7.9): the Algorithms «Просмотр реального лайфкодинга»
// lesson keeps its imported Я.Диск link, and gets a callout pointing to the
// Library where those recordings are moving. Idempotent: skip if already noted,
// skip entirely if no Я.Диск link is present (report it).

const MARKER = "Записи переезжают в раздел";
const NOTE =
  '\n\n:::callout{type="material"}\n' +
  "Записи переезжают в раздел [Библиотека](/library) — там они с водяным знаком и личным доступом, без передачи ссылок.\n" +
  ":::\n";

async function main(): Promise<void> {
  const lessons = await prisma.lesson.findMany({
    where: {
      module: { course: { slug: "algorithms-livecoding" } },
      contentMd: { contains: "disk.yandex" },
    },
    select: { id: true, title: true, contentMd: true },
  });

  if (lessons.length === 0) {
    console.log(
      "livecoding library note: в курсе «Алгоритмы» нет урока со ссылкой на Я.Диск — пропущено (нечего связывать).",
    );
    return;
  }

  let patched = 0;
  let skipped = 0;
  for (const lesson of lessons) {
    if (lesson.contentMd.includes(MARKER)) {
      skipped += 1;
      continue;
    }
    const contentMd = lesson.contentMd + NOTE;
    await prisma.lesson.update({
      where: { id: lesson.id },
      data: { contentMd, readingMinutes: computeReadingMinutes(contentMd) },
    });
    patched += 1;
    console.log(`  + примечание добавлено: «${lesson.title}»`);
  }
  console.log(
    `livecoding library note — добавлено ${patched}, уже было ${skipped}, всего уроков со ссылкой ${lessons.length}.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
