import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";

// One-shot, idempotent rebrand (walk 13.4, block 1.2) of the intro welcome course
// content from MENTORS → PRIME for data that already exists (e.g. the stand). The
// seed constants (lib/services/welcome-course.ts) are updated in the same walk, so
// a FRESH seed already reads «Знакомство с PRIME»; ensureWelcomeCourse early-returns
// when the course exists and never renames it — hence this separate script for
// existing databases.
//
// Scope: the welcome course only (slug `welcome`, which is NOT changed). Rebrands
// the brand token in course.title / course.description and every welcome lesson's
// title / content_md. A pure string replacement of the old brand → new brand:
// idempotent (a second run finds no old token), touches only the welcome course.
//
// This is NOT a semantic edit for students who already passed the lessons:
// `content_updated_at` is deliberately NOT bumped (no «урок обновлён» badge for a
// rename). One audit record summarises the batch.
//
// Run:  pnpm exec tsx scripts/rebrand-welcome.ts --dry-run
//       pnpm exec tsx scripts/rebrand-welcome.ts --commit

const WELCOME_SLUG = "welcome"; // spec 13.4 block 1.2: slug is NOT changed
const OLD_BRAND = "MENTORS";
const NEW_BRAND = "PRIME";

/** Replaces every occurrence of the old brand token with the new one. */
function rebrand(text: string): string {
  return text.split(OLD_BRAND).join(NEW_BRAND);
}

interface FieldChange {
  table: "courses" | "lessons";
  id: string;
  field: "title" | "description" | "contentMd";
  label: string;
  before: string;
  after: string;
}

async function collect(): Promise<FieldChange[]> {
  const course = await prisma.course.findUnique({
    where: { slug: WELCOME_SLUG },
    include: { modules: { include: { lessons: true } } },
  });
  if (!course) return [];

  const changes: FieldChange[] = [];

  const titleAfter = rebrand(course.title);
  if (titleAfter !== course.title) {
    changes.push({
      table: "courses",
      id: course.id,
      field: "title",
      label: course.title,
      before: course.title,
      after: titleAfter,
    });
  }
  const descAfter = rebrand(course.description);
  if (descAfter !== course.description) {
    changes.push({
      table: "courses",
      id: course.id,
      field: "description",
      label: course.title,
      before: course.description,
      after: descAfter,
    });
  }

  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      const lessonTitleAfter = rebrand(lesson.title);
      if (lessonTitleAfter !== lesson.title) {
        changes.push({
          table: "lessons",
          id: lesson.id,
          field: "title",
          label: lesson.title,
          before: lesson.title,
          after: lessonTitleAfter,
        });
      }
      const bodyAfter = rebrand(lesson.contentMd);
      if (bodyAfter !== lesson.contentMd) {
        changes.push({
          table: "lessons",
          id: lesson.id,
          field: "contentMd",
          label: lesson.title,
          before: lesson.contentMd,
          after: bodyAfter,
        });
      }
    }
  }

  return changes;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const dryRun = process.argv.includes("--dry-run") || !commit;

  const course = await prisma.course.findUnique({
    where: { slug: WELCOME_SLUG },
    include: { modules: { include: { lessons: true } } },
  });
  if (!course) {
    console.log(`Welcome-курс (slug «${WELCOME_SLUG}») не найден — нечего ребрендить.`);
    return;
  }
  const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);

  const changes = await collect();
  const lessonFieldChanges = changes.filter((c) => c.table === "lessons").length;
  const lessonsWithBrand = new Set(changes.filter((c) => c.table === "lessons").map((c) => c.id))
    .size;

  console.log(
    `${dryRun ? "[dry-run] " : "[commit] "}Ребрендинг welcome-курса ${OLD_BRAND} → ${NEW_BRAND}:`,
  );
  console.log(`  курс: «${course.title}» (${course.status}, ${lessonCount} уроков)`);
  console.log(
    `  поля курса к правке:   ${changes.filter((c) => c.table === "courses").length} (title/description)`,
  );
  console.log(
    `  уроки с упоминанием:   ${lessonsWithBrand} из ${lessonCount} (${lessonFieldChanges} полей)`,
  );
  console.log(`  всего полей к правке:  ${changes.length}`);

  if (changes.length > 0) {
    console.log("\n  Изменения (до → после):");
    for (const c of changes) {
      const preview =
        c.field === "contentMd"
          ? `${c.before.length} символов (тело урока)`
          : `«${c.before}» → «${c.after}»`;
      console.log(`    • ${c.table}.${c.field} [${c.label}]: ${preview}`);
    }
  }

  if (dryRun) {
    console.log("\n[dry-run] Ничего не записано. Для применения: --commit");
    return;
  }

  if (changes.length === 0) {
    console.log(`\nНечего применять — welcome-курс уже на бренде ${NEW_BRAND}.`);
    return;
  }

  // Actor for the single audit record: the owner (or first admin+).
  const actor = await prisma.user.findFirst({
    where: { role: { in: ["owner", "admin"] } },
    orderBy: { role: "desc" },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      // NB: no content_updated_at bump — this is a rename, not a content rewrite.
      if (c.table === "courses") {
        await tx.course.update({
          where: { id: c.id },
          data: c.field === "title" ? { title: c.after } : { description: c.after },
        });
      } else {
        await tx.lesson.update({
          where: { id: c.id },
          data: c.field === "title" ? { title: c.after } : { contentMd: c.after },
        });
      }
    }
    if (actor) {
      await writeAudit(tx, {
        actorId: actor.id,
        action: "welcome.rebranded",
        entityType: "course",
        entityId: course.id,
        before: { brand: OLD_BRAND },
        after: { brand: NEW_BRAND, fieldsChanged: changes.length },
      });
    }
  });

  console.log(
    `\nПрименено: ${changes.length} полей ребрендинг${actor ? " + 1 запись в аудит" : ""}.`,
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
