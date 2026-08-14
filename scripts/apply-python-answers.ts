import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";

// Замена эталонов 52 Python-вопросов на переписанные ментором (заход «Эталоны
// Python»). Источник — markdown-файл ментора, 15 разделов × 52 вопроса.
//
// Почему НЕ импортёр: `scripts/import-notion.ts` разбирает дерево Notion по
// отступам и СОЗДАЁТ сущности. Здесь нужно точечно обновить `answer_md` у уже
// существующих строк и ничего не создавать — иначе банк раздвоится.
//
// Матчинг «номер в файле → id в банке» сделан ЧТЕНИЕМ и зашит ниже явным
// списком: скрипт ничего не угадывает. У каждой пары есть `expect` — фрагмент
// текста вопроса на момент сверки; если он не совпал, прогон падает целиком, а
// не тихо пишет ответ не туда.
//
// Правила слияния — решения владельца, не эвристики:
//   • `split`   — №13: один новый ответ режется по абзацам на два банковских
//                 вопроса (copy / deepcopy). Оба остаются, слияние запрещено —
//                 они оба ключевые для урока «Функции и их особенности».
//   • `codeTail`— шесть вопросов, где в старом эталоне есть листинг: проза
//                 заменяется, код сохраняется хвостом. Листинг приводится в
//                 порядок — снимается общий отступ от вложенности в список
//                 Notion и проставляется язык фенса (иначе Shiki не
//                 подсвечивает). Строки внутри блока НЕ удаляются, см. cleanFence.
//   • `replace` — остальные 45, включая №46: полная замена без хвоста.
//
// Тексты вопросов (`text_md`) скрипт НЕ трогает: десять «заголовков вместо
// вопросов» правятся отдельным прогоном по решению владельца.
//
// Входной файл лежит в репозитории — `content-source/` (иначе прогон
// невоспроизводим). Run:
//   pnpm exec tsx scripts/apply-python-answers.ts --file=content-source/Python_для_Senior_ML_Engineer_—_вопросы_и_понятные_ответы.md --dry-run
//   … --commit

type Mode = "replace" | "codeTail" | "split";

interface Pair {
  /** Номер вопроса в файле ментора. */
  n: number;
  /** id вопроса в банке. */
  id: string;
  /** Фрагмент text_md на момент сверки — защита от дрейфа id. */
  expect: string;
  mode?: Mode;
  /**
   * Для `split`: какую часть разрезанного ответа взять. Абзацы делятся по
   * маркеру: всё до первого абзаца про глубокое копирование — «поверхностной»
   * половине, остальное — «глубокой».
   */
  splitPart?: "shallow" | "deep";
}

/** Пары «файл → банк». Порядок — как в файле. */
const PAIRS: Pair[] = [
  { n: 1, id: "cmrlybs98008hur7wz41nn59z", expect: "изменяемые, а какие неизменяемые" },
  { n: 2, id: "cmrlybsa6008jur7wthil3lin", expect: "между операторами" },
  { n: 3, id: "cmrlybsb4008lur7weuhrpky4", expect: "ссылки в Python" },
  { n: 4, id: "cmrlybrk4007pur7wi4g3lqc4", expect: "между списками и кортежами" },
  { n: 5, id: "cmrlybrlz007rur7wqay0ufna", expect: "под капотом" },
  { n: 6, id: "cmrlybrmy007tur7wo2zf08wg", expect: "10 миллиардов" },
  { n: 7, id: "cmrlybrpn007vur7ww97fg4mw", expect: "больше весит в памяти" },
  { n: 8, id: "cmrlybrs3007xur7wohdiirf9", expect: "знаете о словарях" },
  { n: 9, id: "cmrlybrty007zur7wyc90v0y5", expect: "константное время" },
  { n: 10, id: "cmrlybrvw0081ur7w1gudx95q", expect: "ключами в словаре" },
  { n: 11, id: "cmrlybrxt0083ur7wdv880kug", expect: "коллизии" },
  { n: 12, id: "cmrlybrzp0085ur7wigyv5ofa", expect: "кортеж быть ключом" },
  {
    n: 13,
    id: "cmrlybscy008nur7wq26unxw1",
    expect: "Поверхностное копирование",
    mode: "split",
    splitPart: "shallow",
  },
  {
    n: 13,
    id: "cmrlybsdw008pur7wddxldqq3",
    expect: "Глубокое копирование",
    mode: "split",
    splitPart: "deep",
  },
  { n: 14, id: "cmrlybsfr008rur7w25oihubc", expect: "значение по умолчанию" },
  { n: 15, id: "cmrlybsgq008tur7w0eewxey6", expect: "hashable" },
  { n: 16, id: "cmrlybsut009dur7wthzzanhg", expect: "self" },
  { n: 17, id: "cmrlybsvs009fur7wu6c1hkal", expect: "инкапсуляция", mode: "codeTail" },
  { n: 18, id: "cmrlybswq009hur7wunvt8729", expect: "наследование", mode: "codeTail" },
  { n: 19, id: "cmrlybsxo009jur7wd1ocl2b8", expect: "полиморфизм", mode: "codeTail" },
  { n: 20, id: "cmrlybsyn009lur7weo43d0rs", expect: "Магические методы" },
  { n: 21, id: "cmrlybs5i008bur7wyf3dgaza", expect: "генераторы в Python" },
  { n: 22, id: "cmrlybs6g008dur7wgpf0cjyu", expect: "создания генераторов" },
  { n: 23, id: "cmrlybs7e008fur7wdxvu78ba", expect: "в одной функции" },
  { n: 24, id: "cmrlybs2q0087ur7wqu16i2ix", expect: "декораторы в Python" },
  { n: 25, id: "cmrlybs3o0089ur7wd7x3yfqe", expect: "повседневной практике" },
  { n: 26, id: "cmrlybsim008vur7wz69xagxs", expect: "контекстные менеджеры" },
  { n: 27, id: "cmrlybsjk008xur7w1wy8rclt", expect: "примеры знаете", mode: "codeTail" },
  { n: 28, id: "cmrlybskj008zur7wb7n2o2hw", expect: "как контекстный менеджер" },
  { n: 29, id: "cmrlybslh0091ur7wfwk5fyhw", expect: "внутри блока" },
  { n: 30, id: "cmrlybt0j009nur7w50fg4l06", expect: "исключения в Python", mode: "codeTail" },
  { n: 31, id: "cmrlybt1h009pur7w30043w7p", expect: "Ключевые слова" },
  { n: 32, id: "cmrlybt3e009rur7w4q3n589h", expect: "память выделяется" },
  { n: 33, id: "cmrlybt4b009tur7wlqcqv441", expect: "память очищается" },
  { n: 34, id: "cmrlybt59009vur7wugve2hiy", expect: "Garbage Collector" },
  { n: 35, id: "cmrlybsnd0093ur7w72lvmvr8", expect: "GIL в Python" },
  { n: 36, id: "cmrlybsoc0095ur7wywdgqv8v", expect: "плох GIL" },
  { n: 37, id: "cmrlybtaw00a1ur7wo45xs19p", expect: "Асинхронность" },
  { n: 38, id: "cmrlybtbv00a3ur7w5u509bua", expect: "Многопоточность" },
  { n: 39, id: "cmrlybtct00a5ur7wngpohj4y", expect: "Многопроцессорность" },
  { n: 40, id: "cmrlybtdq00a7ur7w87d7f5ew", expect: "Когда какой выбирать" },
  { n: 41, id: "cmrlybteo00a9ur7w08fn1pau", expect: "одновременных запросов", mode: "codeTail" },
  { n: 42, id: "cmrlybtfo00abur7wcheh5fyo", expect: "стек и куча" },
  { n: 43, id: "cmrlybtgn00adur7whg3fwflx", expect: "между потоками и процессами" },
  { n: 44, id: "cmrlybthl00afur7wxjsv4v65", expect: "use-cases" },
  { n: 45, id: "cmrlybtij00ahur7wo1mqe5al", expect: "I/O-bound" },
  // №46 — «проза без кода» по решению владельца: прежний технический разбор НЕ
  // сохраняется. Его листинг зовёт `asyncio.gather` без семафора и таймаутов,
  // то есть противоречит прозе над ним («контролирую число операций, ставлю
  // таймауты»), и дублирует пример из №41, где то же самое сделано правильно.
  { n: 46, id: "cmrlybtjh00ajur7wf60vfygw", expect: "Приходилось ли работать" },
  { n: 47, id: "cmrlybtkf00alur7wq2dqx85k", expect: "преимущество asyncio" },
  { n: 48, id: "cmrlybsq60097ur7wac2c32va", expect: "SOLID" },
  { n: 49, id: "cmrlybsr50099ur7wotcsmwkj", expect: "DRY" },
  { n: 50, id: "cmrlybssz009bur7wffzsxqn0", expect: "типизация" },
  { n: 51, id: "cmrlybt74009xur7whswqes43", expect: "контейнеризация" },
  { n: 52, id: "cmrlybt8z009zur7w3tusywer", expect: "микросервисов" },
];

interface FileItem {
  n: number;
  section: string;
  question: string;
  body: string;
}

/** Разбор файла ментора: `### N. вопрос` … `---`. */
function parseSource(path: string): Map<number, FileItem> {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const items = new Map<number, FileItem>();
  let section = "";
  let cur: { n: number; question: string; body: string[] } | null = null;

  const flush = (): void => {
    if (!cur) return;
    items.set(cur.n, {
      n: cur.n,
      section,
      question: cur.question,
      body: cur.body.join("\n").trim(),
    });
    cur = null;
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,2} (?:\d+\. )?(.+)$/);
    if (heading && !line.startsWith("### ")) {
      if (!line.startsWith("# Python для")) section = heading[1]!;
      continue;
    }
    const q = line.match(/^### (\d+)\. (.+)$/);
    if (q) {
      flush();
      cur = { n: Number(q[1]), question: q[2]!, body: [] };
      continue;
    }
    if (!cur) continue;
    if (line.trim() === "---") flush();
    else cur.body.push(line);
  }
  flush();
  return items;
}

/** Фенсы кода из старого эталона, в исходном порядке. */
function codeBlocks(md: string): string[] {
  return md.match(/```[\s\S]*?```/g) ?? [];
}

/**
 * Язык фенса по содержимому — только уверенные случаи. Notion-экспорт вынес
 * ярлык языка ОТДЕЛЬНЫМ абзацем перед блоком, поэтому у всех сохранённых фенсов
 * язык пустой и Shiki их не подсвечивает. Угадывать наугад нельзя: неверный
 * ярлык хуже отсутствующего, поэтому при сомнении возвращается null.
 */
function detectFenceLanguage(code: string): string | null {
  // Python проверяется ПЕРВЫМ и широко. Обратный порядок уже подвёл на прогоне:
  // `with open(...)` ловился регуляркой SQL-«WITH» без учёта регистра, и пять
  // питоновских листингов №27 получили ярлык `sql`.
  if (
    /^\s*(?:import |from \s*\w+ import |async |def |class |@\w+|with |for |while |try:|except |if |print\(|return |lambda |yield )/m.test(
      code,
    )
  ) {
    return "python";
  }
  // SQL — только по регистру и с обязательной второй частью конструкции.
  if (/\bSELECT\b[\s\S]*\bFROM\b/.test(code) || /\b(?:INSERT INTO|CREATE TABLE)\b/.test(code)) {
    return "sql";
  }
  if (/^\s*(?:\$ |pip install|docker |apt-get )/m.test(code)) return "bash";
  return null;
}

/** Общий отступ листинга — артефакт вложенности в список Notion, не код. */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== "").map((l) => l.match(/^[ \t]*/)![0].length);
  const common = indents.length === 0 ? 0 : Math.min(...indents);
  return common === 0 ? lines : lines.map((l) => (l.trim() === "" ? "" : l.slice(common)));
}

/**
 * Приведение сохраняемого листинга в порядок (решение владельца: наследие
 * Notion — не авторский текст).
 *
 * ВАЖНО, что здесь НЕ делается: строки внутри фенса не удаляются. Первый
 * вариант вырезал строки, начинающиеся с `#`, приняв их за markdown-заголовки, —
 * а это комментарии Python (`# файл автоматически закрывается`). Настоящий
 * мусор импорта (заголовки `###`, ярлык языка отдельным абзацем) лежит ВНЕ
 * фенсов и в хвост не попадает по построению: `codeBlocks` берёт только сами
 * блоки. Поэтому здесь остаётся ровно две операции — снять общий отступ от
 * вложенности в список и проставить язык.
 */
function cleanFence(block: string): { code: string; addedLang: string | null; dedented: boolean } {
  const parsed = block.match(/^```([^\n]*)\n([\s\S]*?)```\s*$/);
  if (!parsed) return { code: block, addedLang: null, dedented: false };
  const declared = parsed[1]!.trim();
  const raw = parsed[2]!.replace(/\n\s*$/, "").split("\n");
  const lines = dedent(raw);
  const dedented = lines.join("\n") !== raw.join("\n");

  const body = lines.join("\n");
  const lang = declared || detectFenceLanguage(body) || "";
  return {
    code: "```" + lang + "\n" + body + "\n```",
    addedLang: declared ? null : lang || null,
    dedented,
  };
}

// Подводка перед сохранённым листингом — дословно по решению владельца.
const LEAD_CODE = "**Как это выглядит в коде:**";

/**
 * Разрез №13 по абзацам. Граница — первый абзац, где речь заходит о глубоком
 * копировании; всё до него описывает поверхностное. Если граница не нашлась,
 * прогон падает: молча отдать обеим карточкам один и тот же текст нельзя.
 */
function splitCopyAnswer(body: string): { shallow: string; deep: string } {
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const boundary = paras.findIndex((p) => /глубок/i.test(p));
  if (boundary <= 0 || boundary >= paras.length) {
    throw new Error(
      `№13: не нашёл границу абзацев «поверхностное | глубокое» (абзацев: ${paras.length})`,
    );
  }
  return {
    shallow: paras.slice(0, boundary).join("\n\n"),
    deep: paras.slice(boundary).join("\n\n"),
  };
}

interface Planned {
  pair: Pair;
  questionText: string;
  before: string;
  after: string;
  keptCode: number;
  keptTailChars: number;
  /** Языки, проставленные фенсам без ярлыка. */
  langs: string[];
  /** Сколько листингов лишились общего отступа от списка. */
  dedentedCount: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => a.startsWith("--file="));
  const commit = args.includes("--commit");
  const dryRun = args.includes("--dry-run");
  // --show=41,46 — печатает итоговый эталон ЦЕЛИКОМ, как он ляжет в базу.
  // Нужен для вычитки склейки (пустые строки, целостность ```-блоков).
  const showArg = args.find((a) => a.startsWith("--show="));
  const show = new Set(
    (showArg?.slice("--show=".length) ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n)),
  );
  if (!fileArg) throw new Error("нужен --file=<путь к markdown ментора>");
  if (commit === dryRun) throw new Error("нужен ровно один из --dry-run | --commit");

  const source = parseSource(fileArg.slice("--file=".length));
  if (source.size !== 52) throw new Error(`в файле ${source.size} вопросов, ожидалось 52`);

  const ids = PAIRS.map((p) => p.id);
  const rows = await prisma.question.findMany({
    where: { id: { in: ids } },
    select: { id: true, textMd: true, answerMd: true, status: true, type: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Сверка карты перед любой работой: ни одного «примерно того» вопроса.
  const problems: string[] = [];
  for (const pair of PAIRS) {
    const row = byId.get(pair.id);
    if (!row) {
      problems.push(`№${pair.n}: вопрос ${pair.id} не найден в базе`);
      continue;
    }
    if (!row.textMd.toLowerCase().includes(pair.expect.toLowerCase())) {
      problems.push(
        `№${pair.n}: текст вопроса ${pair.id} изменился — ожидал «${pair.expect}», получил «${row.textMd.slice(0, 60)}…»`,
      );
    }
    if (!source.has(pair.n)) problems.push(`№${pair.n}: нет в файле ментора`);
  }
  if (problems.length > 0) {
    console.error("Карта пар разошлась с базой, прогон остановлен:");
    for (const p of problems) console.error("  ✗ " + p);
    process.exitCode = 1;
    return;
  }

  // Построение новых эталонов.
  const planned: Planned[] = [];
  for (const pair of PAIRS) {
    const row = byId.get(pair.id)!;
    const item = source.get(pair.n)!;
    const before = row.answerMd ?? "";
    let after: string;
    let keptCode = 0;
    let keptTailChars = 0;
    let langs: string[] = [];
    let dedentedCount = 0;

    switch (pair.mode ?? "replace") {
      case "split": {
        const parts = splitCopyAnswer(item.body);
        after = pair.splitPart === "shallow" ? parts.shallow : parts.deep;
        break;
      }
      case "codeTail": {
        const cleaned = codeBlocks(before).map(cleanFence);
        keptCode = cleaned.length;
        langs = cleaned.map((c) => c.addedLang).filter((l): l is string => l !== null);
        dedentedCount = cleaned.filter((c) => c.dedented).length;
        const tail = cleaned.map((c) => c.code).join("\n\n");
        keptTailChars = tail.length;
        after = tail ? `${item.body}\n\n${LEAD_CODE}\n\n${tail}` : item.body;
        break;
      }
      default:
        after = item.body;
    }

    planned.push({
      pair,
      questionText: row.textMd,
      before,
      after,
      keptCode,
      keptTailChars,
      langs,
      dedentedCount,
    });
  }

  // Отчёт.
  console.log(`Источник: ${fileArg.slice("--file=".length)}`);
  console.log(`Режим: ${commit ? "COMMIT" : "dry-run"} · пар в карте: ${PAIRS.length}\n`);

  let unchanged = 0;
  for (const p of planned) {
    const delta = p.after.length - p.before.length;
    const mode = p.pair.mode ?? "replace";
    const suffix =
      mode === "codeTail"
        ? ` · листингов сохранено: ${p.keptCode} (${p.keptTailChars} симв.)` +
          `${p.langs.length > 0 ? ` · язык проставлен: ${p.langs.join(", ")}` : ""}` +
          `${p.dedentedCount > 0 ? ` · снят отступ списка: ${p.dedentedCount}` : ""}`
        : mode === "split"
          ? ` · часть: ${p.pair.splitPart}`
          : "";
    if (p.after === p.before) unchanged += 1;
    console.log(
      `№${String(p.pair.n).padStart(2)} [${mode}] ${p.pair.id}\n` +
        `    вопрос: ${p.questionText.replace(/\s+/g, " ").slice(0, 78)}\n` +
        `    эталон: ${p.before.length} → ${p.after.length} симв. (${delta >= 0 ? "+" : ""}${delta})${suffix}\n` +
        `    было:  ${JSON.stringify(p.before.replace(/\s+/g, " ").slice(0, 100))}\n` +
        `    стало: ${JSON.stringify(p.after.replace(/\s+/g, " ").slice(0, 100))}`,
    );
  }

  for (const p of planned) {
    if (!show.has(p.pair.n)) continue;
    console.log(
      `\n${"=".repeat(72)}\n№${p.pair.n} · ${p.pair.id} · ИТОГОВЫЙ ЭТАЛОН ЦЕЛИКОМ\n` +
        `вопрос: ${p.questionText.replace(/\s+/g, " ")}\n${"=".repeat(72)}`,
    );
    console.log(p.after);
    console.log(`${"=".repeat(72)}\n[конец №${p.pair.n} · ${p.after.length} симв.]`);
  }

  const beforeTotal = planned.reduce((s, p) => s + p.before.length, 0);
  const afterTotal = planned.reduce((s, p) => s + p.after.length, 0);
  console.log(
    `\nИтого: ${planned.length} записей · ${beforeTotal} → ${afterTotal} симв. ` +
      `(${afterTotal - beforeTotal}) · без изменений: ${unchanged}`,
  );

  if (!commit) {
    console.log("\ndry-run: база не тронута.");
    return;
  }

  const owner = await prisma.user.findFirst({ where: { role: "owner" }, select: { id: true } });
  if (!owner) throw new Error("не найден owner для записи в аудит");

  await prisma.$transaction(async (tx) => {
    for (const p of planned) {
      if (p.after === p.before) continue;
      await tx.question.update({ where: { id: p.pair.id }, data: { answerMd: p.after } });
    }
    await writeAudit(tx, {
      actorId: owner.id,
      action: "questions.answers_replaced",
      entityType: "question",
      entityId: "batch:python-reference-answers",
      before: { chars: beforeTotal, count: planned.length },
      after: { chars: afterTotal, count: planned.filter((p) => p.after !== p.before).length },
    });
  });

  console.log("\ncommit: эталоны обновлены, одна запись в аудит.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
