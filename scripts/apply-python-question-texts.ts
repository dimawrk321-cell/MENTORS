import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";

// Формулировки вопросов Python: заголовки Notion → человеческие вопросы
// (заход «Эталоны Python», отдельный прогон после замены эталонов).
//
// Импорт из Notion превратил часть СЕКЦИЙ материала в вопросы банка, поэтому на
// лицевой стороне карточки у ученика стоят не вопросы, а обрывки заголовков:
// «Асинхронность», «Ключевые слова», «Когда какой выбирать». Ученик видит эту
// строку ПЕРВОЙ — в каталоге, в карточке тренажёра и в результатах поиска.
//
// Новые формулировки берутся из того же файла ментора, что и эталоны: заголовок
// `### N. <вопрос>`. Ничего не сочиняется — если у пары нет соответствия в
// файле, прогон падает.
//
// Меняется ТОЛЬКО `text_md`. Эталоны (`answer_md`) уже заменены отдельным
// прогоном `apply-python-answers.ts` и здесь не трогаются.
//
// Побочный эффект, о котором надо знать: `text_md` входит в FTS-вектор вопроса
// (раздел 7.11), поэтому поиск начнёт находить их по новым словам — это и есть
// цель. Карточки SRS привязаны к `question_id`, их правка не затрагивает.
//
// Run:
//   pnpm exec tsx scripts/apply-python-question-texts.ts --file=content-source/Python_для_Senior_ML_Engineer_—_вопросы_и_понятные_ответы.md --dry-run
//   … --commit

interface Pair {
  /** Номер вопроса в файле ментора — из него берётся новая формулировка. */
  n: number;
  /** id вопроса в банке. */
  id: string;
  /** Ожидаемый текущий текст ЦЕЛИКОМ — защита от повторного/ошибочного прогона. */
  expectExact: string;
  /** Зачем правим — попадает в отчёт, чтобы решение было видно глазами. */
  why: string;
}

/**
 * Десять пар. Список закрыт и проверен чтением: это ровно те вопросы, где
 * банковский текст — заголовок раздела, а не вопрос, плюс два, где вопрос
 * сформулирован канцелярски.
 */
const PAIRS: Pair[] = [
  {
    n: 20,
    id: "cmrlybsyn009lur7weo43d0rs",
    expectExact: "Магические методы в Python",
    why: "заголовок раздела, не вопрос",
  },
  {
    n: 27,
    id: "cmrlybsjk008xur7w1wy8rclt",
    expectExact: "Какие примеры знаете?",
    why: "вопрос без предмета: «примеры» чего — видно только из категории",
  },
  {
    n: 31,
    id: "cmrlybt1h009pur7w30043w7p",
    expectExact: "Ключевые слова",
    why: "заголовок раздела, не вопрос",
  },
  {
    n: 32,
    id: "cmrlybt3e009rur7w4q3n589h",
    expectExact: "Каким образом память выделяется?",
    why: "вопрос настоящий, но канцелярский — формулировка ментора живее",
  },
  {
    n: 33,
    id: "cmrlybt4b009tur7wlqcqv441",
    expectExact: "Каким образом память очищается?",
    why: "вопрос настоящий, но канцелярский — формулировка ментора живее",
  },
  {
    n: 34,
    id: "cmrlybt59009vur7wugve2hiy",
    expectExact: "Как работает Garbage Collector",
    why: "вопрос без знака вопроса",
  },
  {
    n: 37,
    id: "cmrlybtaw00a1ur7wo45xs19p",
    expectExact: "Асинхронность",
    why: "заголовок раздела, не вопрос",
  },
  {
    n: 38,
    id: "cmrlybtbv00a3ur7w5u509bua",
    expectExact: "Многопоточность",
    why: "заголовок раздела, не вопрос",
  },
  {
    n: 39,
    id: "cmrlybtct00a5ur7wngpohj4y",
    expectExact: "Многопроцессорность",
    why: "заголовок раздела, не вопрос",
  },
  {
    n: 40,
    id: "cmrlybtdq00a7ur7w87d7f5ew",
    expectExact: "Когда какой выбирать",
    why: "обрывок заголовка, не вопрос",
  },
];

/** Заголовки `### N. <вопрос>` из файла ментора. */
function parseQuestions(path: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^### (\d+)\. (.+)$/);
    if (m) out.set(Number(m[1]), m[2]!.trim());
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith("--file="));
  const commit = args.includes("--commit");
  const dryRun = args.includes("--dry-run");
  if (!fileArg) throw new Error("нужен --file=<путь к markdown ментора>");
  if (commit === dryRun) throw new Error("нужен ровно один из --dry-run | --commit");

  const source = parseQuestions(fileArg.slice("--file=".length));
  const rows = await prisma.question.findMany({
    where: { id: { in: PAIRS.map((p) => p.id) } },
    select: { id: true, textMd: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const problems: string[] = [];
  const planned: { pair: Pair; before: string; after: string }[] = [];
  for (const pair of PAIRS) {
    const row = byId.get(pair.id);
    if (!row) {
      problems.push(`№${pair.n}: вопрос ${pair.id} не найден`);
      continue;
    }
    const after = source.get(pair.n);
    if (!after) {
      problems.push(`№${pair.n}: нет заголовка в файле ментора`);
      continue;
    }
    if (row.textMd.trim() !== pair.expectExact) {
      problems.push(
        `№${pair.n}: текущий текст не совпал с ожидаемым.\n` +
          `      ожидал: ${JSON.stringify(pair.expectExact)}\n` +
          `      в базе: ${JSON.stringify(row.textMd.trim())}`,
      );
      continue;
    }
    planned.push({ pair, before: row.textMd.trim(), after });
  }

  if (problems.length > 0) {
    console.error("Карта пар разошлась с базой, прогон остановлен:");
    for (const p of problems) console.error("  ✗ " + p);
    process.exitCode = 1;
    return;
  }

  console.log(`Режим: ${commit ? "COMMIT" : "dry-run"} · пар: ${planned.length}\n`);
  for (const p of planned) {
    console.log(
      `№${String(p.pair.n).padStart(2)} ${p.pair.id}\n` +
        `    было:  ${p.before}\n` +
        `    стало: ${p.after}\n` +
        `    зачем: ${p.pair.why}\n`,
    );
  }

  if (!commit) {
    console.log("dry-run: база не тронута.");
    return;
  }

  const owner = await prisma.user.findFirst({ where: { role: "owner" }, select: { id: true } });
  if (!owner) throw new Error("не найден owner для записи в аудит");

  await prisma.$transaction(async (tx) => {
    for (const p of planned) {
      await tx.question.update({ where: { id: p.pair.id }, data: { textMd: p.after } });
    }
    await writeAudit(tx, {
      actorId: owner.id,
      action: "questions.texts_rephrased",
      entityType: "question",
      entityId: "batch:python-question-texts",
      before: Object.fromEntries(planned.map((p) => [p.pair.id, p.before])),
      after: Object.fromEntries(planned.map((p) => [p.pair.id, p.after])),
    });
  });
  console.log(`commit: обновлено формулировок ${planned.length}, одна запись в аудит.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
