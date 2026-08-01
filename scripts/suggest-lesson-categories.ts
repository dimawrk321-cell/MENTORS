/**
 * Second pass of question→lesson linking (walk 13.6, block 3v2): by CATEGORY.
 *
 * The hint-based pass (`autolink-questions.ts`) is exhausted — the Notion export
 * carries six hint lines, all in Python + PyTorch, and all 48 links already
 * exist. This pass matches by NAME instead: a lesson's (or its module's) title
 * against a question-bank category, using the importer's own fuzzy matcher so
 * one rule governs the whole platform.
 *
 * Default mode writes NOTHING. It produces `suggestions.md` — a review table of
 * «урок → предложенная категория → сколько вопросов → уверенность» — because a
 * name match is a proposal, not a fact, and the team edits it before anything
 * touches the database.
 *
 * Run:
 *   pnpm exec tsx scripts/suggest-lesson-categories.ts                  # write suggestions.md
 *   pnpm exec tsx scripts/suggest-lesson-categories.ts --out=path.md
 *   pnpm exec tsx scripts/suggest-lesson-categories.ts --apply          # dry run of the links
 *   pnpm exec tsx scripts/suggest-lesson-categories.ts --apply --commit # write the links
 *
 * `--apply` reads the SAME markdown file back: only rows the reviewer left with
 * a `x` in the «взять» column are linked, so the file is the decision record.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { linkCategoryToLesson, suggestLessonCategories } from "@/lib/services/lesson-category-match";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const commit = args.includes("--commit");
const file = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "suggestions.md";

/** `| x | slug | … | categoryId |` — the reviewer only edits the first column. */
function renderTable(
  rows: Array<{
    take: boolean;
    lessonSlug: string;
    lessonTitle: string;
    courseTitle: string;
    moduleTitle: string;
    categoryPath: string;
    questionCount: number;
    alreadyLinked: number;
    confidence: string;
    matchedOn: string;
    lessonId: string;
    categoryId: string;
  }>,
): string {
  const head = [
    "| взять | урок | курс · модуль | категория | вопросов | уже привязано | уверенность | по чему | lessonId | categoryId |",
    "| :-: | --- | --- | --- | --: | --: | --- | --- | --- | --- |",
  ];
  const body = rows.map((r) =>
    [
      r.take ? "x" : " ",
      r.lessonTitle.replace(/\|/g, "\\|"),
      `${r.courseTitle} · ${r.moduleTitle}`.replace(/\|/g, "\\|"),
      r.categoryPath.replace(/\|/g, "\\|"),
      String(r.questionCount),
      String(r.alreadyLinked),
      r.confidence,
      r.matchedOn,
      r.lessonId,
      r.categoryId,
    ]
      .map((cell) => ` ${cell} `)
      .join("|")
      .replace(/^/, "|")
      .replace(/$/, "|"),
  );
  return [...head, ...body].join("\n");
}

/** Reads back the reviewed file: only rows ticked in the «взять» column. */
function parseTicked(markdown: string): Array<{ lessonId: string; categoryId: string }> {
  const out: Array<{ lessonId: string; categoryId: string }> = [];
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 10) continue;
    if (cells[0]?.toLowerCase() !== "x") continue;
    const lessonId = cells[8];
    const categoryId = cells[9];
    if (!lessonId || !categoryId || lessonId === "lessonId") continue;
    out.push({ lessonId, categoryId });
  }
  return out;
}

async function main(): Promise<void> {
  if (!apply) {
    const lessons = await suggestLessonCategories(prisma);
    const rows = lessons.flatMap((lesson) =>
      lesson.suggestions.map((s) => ({
        // Pre-tick only the matches we would defend without a human: an exact
        // name match on the LESSON title that would actually create something.
        take: s.confidence === "высокая" && s.matchedOn === "урок" && s.questionCount > 0,
        lessonSlug: lesson.lessonSlug,
        lessonTitle: lesson.lessonTitle,
        courseTitle: lesson.courseTitle,
        moduleTitle: lesson.moduleTitle,
        categoryPath: s.categoryPath,
        questionCount: s.questionCount,
        alreadyLinked: s.alreadyLinked,
        confidence: s.confidence,
        matchedOn: s.matchedOn,
        lessonId: lesson.lessonId,
        categoryId: s.categoryId,
      })),
    );

    const withNone = lessons.filter((l) => l.suggestions.length === 0);
    const preTicked = rows.filter((r) => r.take).length;
    const wouldCreate = rows
      .filter((r) => r.take)
      .reduce((sum, r) => sum + Math.max(0, r.questionCount - r.alreadyLinked), 0);

    const md = [
      "# Привязка вопросов к урокам по категориям",
      "",
      "Предложения, а не факт: совпадение по названию — это догадка. Поставь `x` в колонке",
      "**взять** у строк, которые берём, убери у промахов, потом:",
      "",
      "```",
      "pnpm exec tsx scripts/suggest-lesson-categories.ts --apply           # пробный прогон",
      "pnpm exec tsx scripts/suggest-lesson-categories.ts --apply --commit  # записать",
      "```",
      "",
      "Роль привязки — **«просто привязан»** (не ключевой, не в квизе). Существующие",
      "привязки не трогаются: уже помеченный ключевым вопрос таким не перестанет быть.",
      "",
      `Уроков просмотрено: **${lessons.length}** · с предложением: **${lessons.length - withNone.length}**`,
      `· строк: **${rows.length}** · заранее отмечено: **${preTicked}** (точное совпадение по названию урока)`,
      `· создалось бы связок: **${wouldCreate}**`,
      "",
      "Уверенность: «высокая» — названия совпали после нормализации; «средняя» — совпали",
      "без скобочных уточнений; «низкая» — совпал только префикс.",
      "",
      renderTable(rows),
      "",
      "## Уроки без предложений",
      "",
      withNone.length === 0
        ? "Нет — каждому уроку что-то предложено."
        : withNone
            .map((l) => `- ${l.courseTitle} · ${l.moduleTitle} · **${l.lessonTitle}**`)
            .join("\n"),
      "",
    ].join("\n");

    writeFileSync(file, md, "utf8");
    console.log(`Уроков: ${lessons.length} · строк-предложений: ${rows.length}`);
    console.log(`Заранее отмечено: ${preTicked} · создалось бы связок: ${wouldCreate}`);
    console.log(`Без предложений: ${withNone.length}`);
    console.log(`\nФайл: ${file} — поправь колонку «взять» и запусти с --apply.`);
    await prisma.$disconnect();
    return;
  }

  // --- apply ---
  let markdown: string;
  try {
    markdown = readFileSync(file, "utf8");
  } catch {
    console.error(`Не могу прочитать ${file}. Сначала сгенерируй его без --apply.`);
    process.exitCode = 1;
    return;
  }

  const picked = parseTicked(markdown);
  if (picked.length === 0) {
    console.error(`В ${file} не отмечено ни одной строки (колонка «взять» = x).`);
    process.exitCode = 1;
    return;
  }

  console.log(commit ? "РЕЖИМ: запись" : "РЕЖИМ: пробный прогон (--commit чтобы записать)");
  console.log(`Отмечено строк: ${picked.length}\n`);

  let created = 0;
  let existing = 0;
  for (const row of picked) {
    const [lesson, category] = await Promise.all([
      prisma.lesson.findUnique({ where: { id: row.lessonId }, select: { title: true } }),
      prisma.questionCategory.findUnique({
        where: { id: row.categoryId },
        select: { title: true },
      }),
    ]);
    if (!lesson || !category) {
      console.log(`  ПРОПУСК: не найден урок или категория (${row.lessonId} / ${row.categoryId})`);
      continue;
    }
    const res = await linkCategoryToLesson(prisma, { ...row, commit });
    created += res.created;
    existing += res.existing;
    console.log(
      `  ${lesson.title} ← ${category.title}: ${commit ? "создано" : "будет создано"} ${res.created}, уже было ${res.existing}`,
    );
  }

  console.log(
    `\nИтого: ${commit ? "создано" : "будет создано"} ${created} связок, уже существовало ${existing}.`,
  );
  if (!commit) console.log("Ничего не записано. Повтори с --commit.");
  await prisma.$disconnect();
}

void main();
