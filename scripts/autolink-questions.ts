/**
 * Links questions to lessons by the importer's «Категории вопросов для заучивания
 * в базе» hints (spec 7.14 п.4, walk 13.6 block 3). Role: «просто привязан»
 * (is_key=false, in_quiz=false). Key questions stay a manual editorial job.
 *
 * The Notion markdown export is REQUIRED: the hints are stripped from content_md
 * during import and never persisted, so there is nothing in the DB to read them
 * from (see lib/services/questions-autolink.ts for the full explanation).
 *
 * Run:
 *   pnpm exec tsx scripts/autolink-questions.ts --file=import/notion/export.md
 *   pnpm exec tsx scripts/autolink-questions.ts --file=… --commit
 *
 * Against the stand, via an SSH tunnel:
 *   ssh -f -N -L 15432:127.0.0.1:5432 mentors-vps
 *   DATABASE_URL=postgresql://mentors:<pw>@127.0.0.1:15432/mentors \
 *     pnpm exec tsx scripts/autolink-questions.ts --file=… --commit
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { autolinkQuestions } from "@/lib/services/questions-autolink";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const file = args.find((a) => a.startsWith("--file="))?.slice("--file=".length);

async function main() {
  if (!file) {
    console.error(
      "Нужен --file=<путь к markdown-экспорту Notion>.\n" +
        "Подсказок «категории для заучивания» нет в базе — импортер вырезает эту строку\n" +
        "при конверсии, поэтому скрипт восстанавливает план из исходного экспорта.",
    );
    process.exitCode = 1;
    return;
  }

  let markdown: string;
  try {
    markdown = readFileSync(file, "utf8");
  } catch {
    console.error(`Не могу прочитать файл: ${file}`);
    process.exitCode = 1;
    return;
  }

  const report = await autolinkQuestions(prisma, { markdown, commit });

  console.log(`Уроков с подсказками в экспорте: ${report.lessonsWithHints}`);
  console.log(`Найдено в базе: ${report.lessonsMatched}`);
  if (report.lessonsMissing.length > 0) {
    console.log(
      `НЕ найдено (${report.lessonsMissing.length}): ${report.lessonsMissing.join(", ")}`,
    );
  }
  if (report.categoriesMissing.length > 0) {
    console.log(
      `Категории без совпадения (${report.categoriesMissing.length}): ${report.categoriesMissing.join(", ")}`,
    );
  }
  console.log(`Связок ${commit ? "создано" : "будет создано"}: ${report.created}`);
  console.log(`Уже существовало (не тронуто): ${report.skippedExisting}`);

  for (const row of report.perLesson) {
    if (row.created === 0 && row.existing === 0) continue;
    console.log(
      `  ${row.lesson} — ${row.categories.join("; ")} → +${row.created}, было ${row.existing}`,
    );
  }

  console.log(
    commit
      ? "\nЗаписано в БД (--commit)."
      : "\nDry-run — ничего не записано. Для записи добавь --commit",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
