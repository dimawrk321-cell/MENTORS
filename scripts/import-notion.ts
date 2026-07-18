import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { runImport } from "@/lib/services/notion-import/runner";

// One-off Notion importer, CLI path (spec 7.14). Same service code as the
// /admin/import page — both call runImport(); there is no second import logic.
//   pnpm import -- --file=<путь к .md> --dry-run | --commit
// Report → console + import-report.md. Everything is created as draft.

interface Args {
  file: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let file = "";
  let dryRun: boolean | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--commit") dryRun = false;
  }
  if (!file) {
    throw new Error("Укажи файл: pnpm import -- --file=<путь> --dry-run|--commit");
  }
  if (dryRun === null) {
    throw new Error("Укажи режим: --dry-run или --commit");
  }
  return { file, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);
  const markdown = fs.readFileSync(filePath, "utf8");

  const { report } = await runImport({
    db: prisma,
    markdown,
    imagesDir: path.dirname(filePath),
    dryRun: args.dryRun,
    fileLabel: args.file,
  });

  const reportPath = path.resolve(process.cwd(), "import-report.md");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(report);
  console.log(`\nОтчёт сохранён: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
