import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db";
import { buildImportPlan } from "./plan";
import { commitPlan, type CommitResult } from "./commit";
import { renderReport } from "./report";
import { imageBasename } from "./images";
import type { ImageRef, ImportPlan } from "./types";

// Single import codepath (spec 7.14). BOTH entry points — the CLI
// (`scripts/import-notion.ts`, `pnpm import`) and the admin page
// (`/admin/import`) — call `runImport`; there is no second import logic. Given
// the export markdown and a directory of image files, it builds the plan,
// commits (or dry-runs) it idempotently, copies referenced images, and renders
// the CLI-identical .md report. Pure orchestration over plan/commit/report.

/** Where imported images land, served from /public (spec 7.14). */
const MEDIA_DIR = path.resolve(process.cwd(), "public/media/import");

/** Recursively collects image files under a directory: basename → full path. */
export function collectImages(dir: string): Map<string, string> {
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

/** Locate an image ref's source file: by relative path under rootDir, else by basename. */
function resolveImageSource(
  ref: ImageRef,
  rootDir: string | null,
  basenameToPath: Map<string, string>,
): string | null {
  if (rootDir) {
    const direct = path.resolve(rootDir, ref.originalDecodedPath);
    // Containment guard (stage 12.2, adversarial finding): a markdown image ref
    // with a traversing/absolute path — `![x](../../../etc/ssl/logo.png)` or
    // `/home/other/photo.png` — must NOT escape rootDir and copy an arbitrary
    // server file into the public web root. If it escapes, fall through to the
    // basename lookup below, which only maps files under the provided image dir.
    const rel = path.relative(rootDir, direct);
    const contained = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
    if (contained && fs.existsSync(direct)) return direct;
  }
  const byBase = basenameToPath.get(imageBasename(ref.originalDecodedPath));
  return byBase && fs.existsSync(byBase) ? byBase : null;
}

/** Copies referenced images to public/media/import/ under their normalized names. */
export function copyImages(
  refs: ImageRef[],
  rootDir: string | null,
  basenameToPath: Map<string, string>,
): { copied: number; missing: number } {
  let copied = 0;
  let missing = 0;
  if (refs.length > 0) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  for (const ref of refs) {
    const src = resolveImageSource(ref, rootDir, basenameToPath);
    if (!src) {
      missing += 1;
      continue;
    }
    fs.copyFileSync(src, path.join(MEDIA_DIR, ref.normalizedName));
    copied += 1;
  }
  return { copied, missing };
}

/** Dry-run counterpart of copyImages: how many referenced files are absent. */
export function countMissingImages(
  refs: ImageRef[],
  rootDir: string | null,
  basenameToPath: Map<string, string>,
): number {
  let missing = 0;
  for (const ref of refs) {
    if (!resolveImageSource(ref, rootDir, basenameToPath)) missing += 1;
  }
  return missing;
}

/** Progress phase reported to the caller (drives /admin/import's status polling). */
export type ImportPhase = "parsing" | "planning" | "committing";

export interface RunImportInput {
  db: Db;
  /** The export markdown text. */
  markdown: string;
  /** Directory whose files satisfy image refs (mdDir for CLI, extracted zip dir for admin). */
  imagesDir?: string | null;
  dryRun: boolean;
  /** Shown in the report header (relative path for CLI, uploaded filename for admin). */
  fileLabel: string;
  /** Called at each phase boundary (parsed → planned → committing) — optional. */
  onPhase?: (phase: ImportPhase) => Promise<void> | void;
}

export interface RunImportOutput {
  plan: ImportPlan;
  result: CommitResult;
  /** CLI-identical .md report (spec 7.14 п.6). */
  report: string;
  imagesCopied: number;
  imagesMissing: number;
}

/** Parse → plan → commit/dry-run → images → report. The one shared import run. */
export async function runImport(input: RunImportInput): Promise<RunImportOutput> {
  const basenameToPath = input.imagesDir
    ? collectImages(input.imagesDir)
    : new Map<string, string>();
  const availableImages = new Set(basenameToPath.keys());

  await input.onPhase?.("parsing");
  const plan = buildImportPlan(input.markdown, availableImages);
  await input.onPhase?.("planning");
  await input.onPhase?.("committing");
  const result = await commitPlan(input.db, plan, { dryRun: input.dryRun });

  const rootDir = input.imagesDir ?? null;
  let imagesCopied: number;
  let imagesMissing: number;
  if (input.dryRun) {
    // Dry-run: report which referenced files are present, without copying.
    imagesMissing = countMissingImages(plan.images, rootDir, basenameToPath);
    imagesCopied = plan.images.length - imagesMissing;
  } else {
    const outcome = copyImages(plan.images, rootDir, basenameToPath);
    imagesCopied = outcome.copied;
    imagesMissing = outcome.missing;
  }

  const report = renderReport(plan, result, {
    file: input.fileLabel,
    imagesCopied,
    imagesMissing,
  });
  return { plan, result, report, imagesCopied, imagesMissing };
}
