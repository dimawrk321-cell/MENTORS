import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { buildImportPlan } from "@/lib/services/notion-import/plan";
import { commitPlan } from "@/lib/services/notion-import/commit";
import { renderReport } from "@/lib/services/notion-import/report";
import { imageBasename } from "@/lib/services/notion-import/images";

// One-off Notion importer, part 1 (spec 7.14, importer stage 3.5).
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

/** Recursively collects image files under a directory: basename → full path. */
function collectImages(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)) map.set(entry.name, full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return map;
}

const MEDIA_DIR = path.resolve(process.cwd(), "public/media/import");

function copyImages(
  refs: Array<{ originalDecodedPath: string; normalizedName: string }>,
  mdDir: string,
  basenameToPath: Map<string, string>,
): { copied: number; missing: number } {
  let copied = 0;
  let missing = 0;
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  for (const ref of refs) {
    const direct = path.resolve(mdDir, ref.originalDecodedPath);
    const src = fs.existsSync(direct)
      ? direct
      : basenameToPath.get(imageBasename(ref.originalDecodedPath));
    if (!src || !fs.existsSync(src)) {
      missing += 1;
      continue;
    }
    fs.copyFileSync(src, path.join(MEDIA_DIR, ref.normalizedName));
    copied += 1;
  }
  return { copied, missing };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);
  const markdown = fs.readFileSync(filePath, "utf8");
  const mdDir = path.dirname(filePath);

  const basenameToPath = collectImages(mdDir);
  const availableImages = new Set(basenameToPath.keys());

  const plan = buildImportPlan(markdown, availableImages);
  const result = await commitPlan(prisma, plan, { dryRun: args.dryRun });

  let imagesCopied = 0;
  let imagesMissing = plan.images.length;
  if (!args.dryRun) {
    const outcome = copyImages(plan.images, mdDir, basenameToPath);
    imagesCopied = outcome.copied;
    imagesMissing = outcome.missing;
  } else {
    // Dry-run: report which referenced files are present, without copying.
    imagesMissing = plan.images.filter(
      (ref) =>
        !fs.existsSync(path.resolve(mdDir, ref.originalDecodedPath)) &&
        !basenameToPath.has(imageBasename(ref.originalDecodedPath)),
    ).length;
    imagesCopied = plan.images.length - imagesMissing;
  }

  const report = renderReport(plan, result, {
    file: args.file,
    imagesCopied,
    imagesMissing,
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
