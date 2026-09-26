import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ContentStatus, GuideSection, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";
import { hasUnsafeRecordingReference } from "@/lib/utils/content-safety";
import { computeReadingMinutes, renderMarkdownHtml } from "@/lib/utils/markdown";

// Точечная воспроизводимая синхронизация гайда команды из Notion. Источник
// хранится в репозитории, а запись определяется стабильным slug — повторный
// прогон обновляет ту же сущность и не создаёт дубль.
//
// По умолчанию скрипт только показывает план:
//   pnpm content:vibe-coding -- --dry-run
//
// Запись требует реального сотрудника для аудита:
//   pnpm content:vibe-coding -- --commit --actor=owner@example.com

const SOURCE_FILE = "content-source/vibe-coding-python-codex.md";
const SLUG = "vibe-coding-python-codex";
const TITLE = "Вайб-кодинг: Python-сервис с Codex";
const SECTION: GuideSection = "stages";
const STATUS: ContentStatus = "published";
const STAFF_ROLES: Role[] = ["owner", "admin", "mentor"];

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() || null
  );
}

async function validateSource(contentMd: string): Promise<{ headings: number; minutes: number }> {
  if (contentMd.trim().length === 0) throw new Error(`Пустой источник: ${SOURCE_FILE}`);
  if (hasUnsafeRecordingReference(contentMd)) {
    throw new Error("В гайде найдена прямая ссылка на запись — публикация запрещена.");
  }

  const html = await renderMarkdownHtml(contentMd);
  const headings = (html.match(/<h[2-6][ >]/g) ?? []).length;
  if (headings < 20) {
    throw new Error(`Источник выглядит неполным: найдено только ${headings} заголовков.`);
  }
  return { headings, minutes: computeReadingMinutes(contentMd) };
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const actorEmail = argument("actor");
  const contentMd = readFileSync(resolve(process.cwd(), SOURCE_FILE), "utf8").trimEnd();
  const source = await validateSource(contentMd);
  const current = await prisma.guide.findUnique({ where: { slug: SLUG } });
  const unchanged =
    current !== null &&
    current.title === TITLE &&
    current.section === SECTION &&
    current.status === STATUS &&
    current.contentMd === contentMd;

  console.log(`${commit ? "[commit]" : "[dry-run]"} ${TITLE}`);
  console.log(`  источник: ${SOURCE_FILE}`);
  console.log(
    `  раздел: ${SECTION}; заголовков: ${source.headings}; чтение: ~${source.minutes} мин`,
  );
  console.log(`  действие: ${unchanged ? "без изменений" : current ? "обновить" : "создать"}`);

  if (!commit) {
    console.log("  ничего не записано; для применения добавь --commit --actor=<email>");
    return;
  }
  if (!actorEmail) throw new Error("Для --commit обязателен --actor=<email> реального сотрудника.");

  const actor = await prisma.user.findFirst({
    where: { email: { equals: actorEmail, mode: "insensitive" }, role: { in: STAFF_ROLES } },
    select: { id: true, email: true, role: true },
  });
  if (!actor) throw new Error(`Сотрудник для аудита не найден: ${actorEmail}`);
  if (unchanged) {
    console.log("  база уже совпадает с источником; запись и аудит не создавались");
    return;
  }

  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.guide.findUnique({ where: { slug: SLUG } });
    const last = before
      ? null
      : await tx.guide.findFirst({
          where: { section: SECTION },
          orderBy: { order: "desc" },
          select: { order: true },
        });
    const guide = before
      ? await tx.guide.update({
          where: { id: before.id },
          data: { title: TITLE, section: SECTION, contentMd, status: STATUS },
        })
      : await tx.guide.create({
          data: {
            slug: SLUG,
            title: TITLE,
            section: SECTION,
            order: (last?.order ?? -1) + 1,
            contentMd,
            status: STATUS,
          },
        });

    await writeAudit(tx, {
      actorId: actor.id,
      action: "guide.source_synced",
      entityType: "guide",
      entityId: guide.id,
      before: before
        ? {
            slug: before.slug,
            title: before.title,
            section: before.section,
            status: before.status,
            contentLength: before.contentMd.length,
          }
        : { exists: false },
      after: {
        slug: guide.slug,
        title: guide.title,
        section: guide.section,
        status: guide.status,
        contentLength: guide.contentMd.length,
        source: SOURCE_FILE,
      },
    });
    return guide;
  });

  console.log(`  готово: ${saved.id}; актор: ${actor.email} (${actor.role})`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
