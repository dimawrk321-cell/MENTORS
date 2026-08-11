/**
 * Отчёт «опубликованные вопросы без эталона или с мусорным эталоном»
 * (заход «Доступ к вопросам», блок 1.3).
 *
 * Читает базу и ничего не меняет. Классы находок:
 *   • ПУСТО     — открытый вопрос, эталон пуст или из одних пробелов. Такой
 *                 вопрос платформа ученику уже не показывает (блок 1.1) — его
 *                 надо дописать, иначе он просто исчез из банка;
 *   • КОРОТКО   — эталон короче порога (по умолчанию 40 значимых символов):
 *                 обычно это заглушка вроде «ва» или ответ в одно слово;
 *   • КАРТИНКА  — эталон состоит только из изображений, без текста: наследие
 *                 импорта Notion, формулы и текст надо переписать вручную.
 *
 *   pnpm exec tsx scripts/report-thin-answers.ts               # в консоль
 *   pnpm exec tsx scripts/report-thin-answers.ts --min 60      # другой порог
 *   pnpm exec tsx scripts/report-thin-answers.ts --md отчёт.md # ещё и в файл
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Verdict = "ПУСТО" | "КОРОТКО" | "КАРТИНКА";

interface Row {
  verdict: Verdict;
  id: string;
  category: string;
  question: string;
  answer: string;
  length: number;
  lessons: string[];
}

const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;

function oneLine(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Значимая длина: без изображений и разметки — «![img](…)» ответом не считается. */
function meaningfulLength(answer: string): number {
  return answer.replace(IMAGE_RE, " ").replace(/[#*`_>~\-\s]/g, "").length;
}

function classify(answer: string | null, minLength: number): Verdict | null {
  const value = (answer ?? "").trim();
  if (value === "") return "ПУСТО";
  const meaningful = meaningfulLength(value);
  if (meaningful === 0 && IMAGE_RE.test(value)) return "КАРТИНКА";
  IMAGE_RE.lastIndex = 0;
  if (meaningful < minLength) return "КОРОТКО";
  return null;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const minLength = Number(argValue("--min") ?? 40);
  const mdPath = argValue("--md");

  // Правило блока 1 касается ОТКРЫТЫХ вопросов: у закрытых обратная сторона —
  // варианты и разбор, а не answer_md.
  const questions = await db.question.findMany({
    where: { status: "published", type: "open" },
    select: {
      id: true,
      textMd: true,
      answerMd: true,
      category: { select: { title: true, parent: { select: { title: true } } } },
      lessonLinks: {
        select: { isKey: true, lesson: { select: { title: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: Row[] = [];
  for (const question of questions) {
    const verdict = classify(question.answerMd, minLength);
    if (!verdict) continue;
    const parent = question.category.parent?.title;
    rows.push({
      verdict,
      id: question.id,
      category: parent ? `${parent} / ${question.category.title}` : question.category.title,
      question: oneLine(question.textMd, 80),
      answer: oneLine(question.answerMd ?? "", 60),
      length: meaningfulLength((question.answerMd ?? "").trim()),
      lessons: question.lessonLinks.map(
        (link) => `${link.lesson.title}${link.isKey ? " (ключевой)" : ""}`,
      ),
    });
  }

  const order: Verdict[] = ["ПУСТО", "КОРОТКО", "КАРТИНКА"];
  rows.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.length - b.length);

  const lines: string[] = [];
  lines.push(`Опубликованных открытых вопросов: ${questions.length}`);
  for (const verdict of order) {
    lines.push(`  ${verdict}: ${rows.filter((row) => row.verdict === verdict).length}`);
  }
  lines.push("");
  for (const row of rows) {
    lines.push(`[${row.verdict}] ${row.question}`);
    lines.push(`    id: ${row.id} · категория: ${row.category} · символов: ${row.length}`);
    lines.push(`    эталон: ${row.answer || "—"}`);
    if (row.lessons.length > 0) lines.push(`    уроки: ${row.lessons.join("; ")}`);
    lines.push("");
  }

  const text = lines.join("\n");
  console.log(text);
  if (mdPath) {
    writeFileSync(mdPath, text, "utf8");
    console.log(`Отчёт записан: ${mdPath}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
