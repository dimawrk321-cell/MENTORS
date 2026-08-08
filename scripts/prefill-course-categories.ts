/**
 * Предзаполнение связи «курс ↔ категории банка» (заход «Банк вопросов», блок A1).
 *
 * Категория относится к курсу, если её вопросы привязаны к урокам этого курса —
 * считается по УЖЕ существующим привязкам вопрос→урок, никакой новой эвристики.
 * Скрипт идемпотентен: существующие связи не дублируются и не удаляются, правки
 * ментора в редакторе курса переживают повторный прогон.
 *
 *   pnpm exec tsx scripts/prefill-course-categories.ts            # отчёт (dry-run)
 *   pnpm exec tsx scripts/prefill-course-categories.ts --commit   # записать
 */
import { PrismaClient } from "@prisma/client";
import { computeCourseCategoryPrefill } from "@/lib/services/question-access";

const db = new PrismaClient();

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const rows = await computeCourseCategoryPrefill(db);
  const existing = await db.courseQuestionCategory.findMany({
    select: { courseId: true, categoryId: true },
  });
  const have = new Set(existing.map((e) => `${e.courseId}:${e.categoryId}`));

  let created = 0;
  let skipped = 0;
  let currentCourse = "";
  for (const row of rows) {
    if (row.courseTitle !== currentCourse) {
      currentCourse = row.courseTitle;
      console.log(`\n${currentCourse}`);
    }
    const key = `${row.courseId}:${row.categoryId}`;
    const already = have.has(key);
    console.log(
      `  ${already ? "=" : "+"} ${row.categoryTitle} — вопросов: ${row.questions}${
        already ? " (уже связано)" : ""
      }`,
    );
    if (already) {
      skipped += 1;
      continue;
    }
    created += 1;
    if (commit) {
      await db.courseQuestionCategory.create({
        data: { courseId: row.courseId, categoryId: row.categoryId },
      });
    }
  }

  const categories = await db.questionCategory.count();
  const linked = new Set(rows.map((r) => r.categoryId)).size;
  console.log(
    `\nИтого: пар курс↔категория ${rows.length}, из них новых ${created}, уже было ${skipped}.`,
  );
  console.log(
    `Категорий всего ${categories}, из них попали в связь ${linked}; остальные — общий пул (видны всем).`,
  );
  console.log(commit ? "Записано (--commit)." : "Сухой прогон — ничего не записано.");
}

main().finally(() => db.$disconnect());
