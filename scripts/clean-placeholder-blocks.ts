/**
 * Removes untouched editor-insert templates from lesson/guide content (walk 13.6
 * block 1.5). The old toolbar pasted raw skeletons (`:::callout{…}` with «Текст
 * совета.», `:::video{url="https://youtu.be/..."}`, a `$$ E = mc^2 $$` sample);
 * while the team explored the buttons, those skeletons were left in place and
 * pushed the real content down — most visibly on the welcome lesson.
 *
 * Only blocks that still match a template character-for-character are removed
 * (see stripPlaceholderBlocks), so edited blocks and real content are safe.
 *
 * Run (dry-run prints a unified diff and changes nothing):
 *   pnpm exec tsx scripts/clean-placeholder-blocks.ts
 *   pnpm exec tsx scripts/clean-placeholder-blocks.ts --commit
 *   pnpm exec tsx scripts/clean-placeholder-blocks.ts --all --commit
 *   pnpm exec tsx scripts/clean-placeholder-blocks.ts --slug=kak-ustroeno-obuchenie
 *
 * Against the stand, via an SSH tunnel:
 *   ssh -f -N -L 15432:127.0.0.1:5432 mentors-vps
 *   DATABASE_URL=postgresql://mentors:<pw>@127.0.0.1:15432/mentors pnpm exec tsx \
 *     scripts/clean-placeholder-blocks.ts --commit
 */
import { prisma } from "@/lib/db";
import { stripPlaceholderBlocks } from "@/lib/content/editor-snippets";

const DEFAULT_SLUG = "kak-ustroeno-obuchenie";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const all = args.includes("--all");
const slugArg = args.find((a) => a.startsWith("--slug="))?.slice("--slug=".length);

/** Line diff over a real LCS table — a greedy scan mislabels moved lines. */
function diff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  while (i < a.length) {
    out.push(`- ${a[i]}`);
    i += 1;
  }
  while (j < b.length) {
    out.push(`+ ${b[j]}`);
    j += 1;
  }
  // Trim long runs of unchanged context so the diff stays readable.
  const trimmed: string[] = [];
  let unchanged = 0;
  for (const line of out) {
    if (line.startsWith("  ")) {
      unchanged += 1;
      if (unchanged <= 2) trimmed.push(line);
      else if (unchanged === 3) trimmed.push("  …");
      continue;
    }
    unchanged = 0;
    trimmed.push(line);
  }
  return trimmed.join("\n");
}

async function main() {
  const lessons = await prisma.lesson.findMany({
    where: all ? {} : { slug: slugArg ?? DEFAULT_SLUG },
    select: { id: true, slug: true, title: true, contentMd: true },
    orderBy: { createdAt: "asc" },
  });
  const guides = all
    ? await prisma.guide.findMany({
        select: { id: true, slug: true, title: true, contentMd: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  if (lessons.length === 0 && guides.length === 0) {
    console.log(`Ничего не найдено (slug=${slugArg ?? DEFAULT_SLUG}). Используй --all.`);
    return;
  }

  const targets = [
    ...lessons.map((l) => ({ kind: "lesson" as const, ...l })),
    ...guides.map((g) => ({ kind: "guide" as const, ...g })),
  ];

  let touched = 0;
  let blocksRemoved = 0;

  for (const target of targets) {
    const { content, removed } = stripPlaceholderBlocks(target.contentMd);
    if (removed.length === 0 || content === target.contentMd) continue;

    touched += 1;
    const n = removed.reduce((sum, r) => sum + r.count, 0);
    blocksRemoved += n;

    console.log(`\n=== ${target.kind}: ${target.title} (${target.slug})`);
    console.log(
      `удалено блоков: ${n} — ${removed.map((r) => `${r.block} ×${r.count}`).join(", ")}`,
    );
    console.log(`символов: ${target.contentMd.length} → ${content.length}`);
    console.log("--- diff ---");
    console.log(diff(target.contentMd, content));

    if (commit) {
      if (target.kind === "lesson") {
        await prisma.lesson.update({
          where: { id: target.id },
          data: { contentMd: content, contentUpdatedAt: new Date() },
        });
      } else {
        await prisma.guide.update({ where: { id: target.id }, data: { contentMd: content } });
      }
    }
  }

  console.log(
    `\nИтого: проверено ${targets.length}, затронуто ${touched}, удалено блоков ${blocksRemoved}.`,
  );
  console.log(
    commit ? "Записано в БД (--commit)." : "Dry-run — ничего не записано. Для записи: --commit",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
