import { prisma } from "@/lib/db";
import { normalizeImportedMarkdown } from "@/lib/services/notion-import/normalize";
import { renderMarkdownHtml } from "@/lib/utils/markdown";
import { writeAudit } from "@/lib/services/audit";

// One-shot, idempotent repair (walk 12.3, P3b) of markdown imported before the
// P3a fix: `lessons.content_md`, `questions.answer_md`, `guides.content_md`. The
// Notion export nested section bodies deeper than their headings, leaving a
// ≥4-space residual indent that CommonMark read as indented code blocks — so
// «### …» and «[url](url)» rendered literally. `normalizeImportedMarkdown`
// re-indents to canonical structure (fenced code + tables preserved) and is
// idempotent, so re-runs are safe.
//
// This is NOT a semantic edit: `content_updated_at` is deliberately NOT bumped
// (no «урок обновлён» badge for a formatting repair). One audit record summarises
// the batch. A render pass verifies no repaired text still emits a literal «###».
//
// Run:  pnpm exec tsx scripts/normalize-imported-md.ts --dry-run
//       pnpm exec tsx scripts/normalize-imported-md.ts --commit

interface Change {
  table: string;
  id: string;
  label: string;
  before: string;
  after: string;
}

/** Count of literal ATX-heading markers left in the rendered HTML (should be 0). */
async function literalHeadings(md: string): Promise<number> {
  const html = await renderMarkdownHtml(md);
  return (html.match(/#{2,6}\s/g) || []).length;
}

/** Compact preview of the first few changed line pairs. */
function diffPreview(before: string, after: string, maxLines = 4): string {
  const b = before.split("\n");
  const a = after.split("\n");
  const rows: string[] = [];
  for (let i = 0; i < Math.max(b.length, a.length) && rows.length < maxLines * 2; i += 1) {
    if (b[i] !== a[i]) {
      if (b[i] !== undefined) rows.push(`    - ${JSON.stringify(b[i])}`);
      if (a[i] !== undefined) rows.push(`    + ${JSON.stringify(a[i])}`);
    }
  }
  return rows.join("\n");
}

async function collect(): Promise<Change[]> {
  const changes: Change[] = [];

  const lessons = await prisma.lesson.findMany({
    select: { id: true, title: true, contentMd: true },
  });
  for (const l of lessons) {
    const after = normalizeImportedMarkdown(l.contentMd);
    if (after !== l.contentMd)
      changes.push({ table: "lessons", id: l.id, label: l.title, before: l.contentMd, after });
  }

  const questions = await prisma.question.findMany({
    where: { answerMd: { not: null } },
    select: { id: true, textMd: true, answerMd: true },
  });
  for (const q of questions) {
    if (!q.answerMd) continue;
    const after = normalizeImportedMarkdown(q.answerMd);
    if (after !== q.answerMd)
      changes.push({
        table: "questions",
        id: q.id,
        label: q.textMd.slice(0, 48),
        before: q.answerMd,
        after,
      });
  }

  const guides = await prisma.guide.findMany({
    select: { id: true, title: true, contentMd: true },
  });
  for (const g of guides) {
    const after = normalizeImportedMarkdown(g.contentMd);
    if (after !== g.contentMd)
      changes.push({ table: "guides", id: g.id, label: g.title, before: g.contentMd, after });
  }

  return changes;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const dryRun = process.argv.includes("--dry-run") || !commit;

  const changes = await collect();
  const byTable = (t: string) => changes.filter((c) => c.table === t).length;

  const totals = {
    lessons: await prisma.lesson.count(),
    questions: await prisma.question.count({ where: { answerMd: { not: null } } }),
    guides: await prisma.guide.count(),
  };

  console.log(`${dryRun ? "[dry-run] " : "[commit] "}Ремонт импортированного markdown:`);
  console.log(`  lessons.content_md:    ${byTable("lessons")} из ${totals.lessons} к правке`);
  console.log(`  questions.answer_md:   ${byTable("questions")} из ${totals.questions} к правке`);
  console.log(`  guides.content_md:     ${byTable("guides")} из ${totals.guides} к правке`);
  console.log(`  всего затронуто:       ${changes.length}`);

  // Render gate: every repaired text must pass the pipeline without literal «###».
  let residualLiterals = 0;
  const offenders: string[] = [];
  for (const c of changes) {
    if ((await literalHeadings(c.after)) > 0) {
      residualLiterals += 1;
      offenders.push(`${c.table}:${c.id} «${c.label}»`);
    }
  }
  console.log(
    `  рендер-тест затронутых: ${changes.length - residualLiterals}/${changes.length} без литеральных «###»`,
  );
  if (residualLiterals > 0) {
    console.log("  ⚠ остаточные литеральные заголовки:");
    for (const o of offenders.slice(0, 10)) console.log(`    - ${o}`);
  }

  if (dryRun) {
    console.log("\n[dry-run] Примеры изменений (до/после):");
    for (const c of changes.slice(0, 5)) {
      console.log(`  • ${c.table} «${c.label}»`);
      console.log(diffPreview(c.before, c.after));
    }
    console.log("\n[dry-run] Ничего не записано. Для применения: --commit");
    return;
  }

  if (changes.length === 0) {
    console.log("\nНечего применять — весь контент уже нормализован.");
    return;
  }

  // Actor for the single audit record: the owner (or first admin+).
  const actor = await prisma.user.findFirst({
    where: { role: { in: ["owner", "admin"] } },
    orderBy: { role: "desc" },
    select: { id: true },
  });

  await prisma.$transaction(
    async (tx) => {
      for (const c of changes) {
        // NB: no content_updated_at bump — this is a formatting repair, not a rewrite.
        if (c.table === "lessons")
          await tx.lesson.update({ where: { id: c.id }, data: { contentMd: c.after } });
        else if (c.table === "questions")
          await tx.question.update({ where: { id: c.id }, data: { answerMd: c.after } });
        else await tx.guide.update({ where: { id: c.id }, data: { contentMd: c.after } });
      }
      if (actor) {
        await writeAudit(tx, {
          actorId: actor.id,
          action: "content.normalized",
          entityType: "content",
          entityId: "batch",
          after: {
            lessons: byTable("lessons"),
            questions: byTable("questions"),
            guides: byTable("guides"),
            total: changes.length,
          },
        });
      }
    },
    // Hundreds of row updates in one atomic batch — the 5s interactive default is
    // easily exceeded over a remote (tunnelled) connection; give it real headroom.
    { timeout: 180_000, maxWait: 15_000 },
  );

  console.log(
    `\nПрименено: ${changes.length} записей нормализовано${actor ? " + 1 запись в аудит" : ""}.`,
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
