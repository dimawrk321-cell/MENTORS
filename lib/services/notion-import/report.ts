import type { ImportPlan } from "./types";
import type { CommitResult, Counts } from "./commit";

// Import report (spec 7.14 п.6): created/skipped per type + anomalies. Rendered
// to both the console and import-report.md. Russian, human-readable.

function countLine(label: string, c: Counts): string {
  return `- ${label}: создано ${c.created}, пропущено ${c.skipped}`;
}

export function renderReport(
  plan: ImportPlan,
  result: CommitResult,
  meta: { file: string; imagesCopied: number; imagesMissing: number },
): string {
  const a = plan.anomalies;
  const lines: string[] = [];

  lines.push(`# Отчёт импортера Notion — часть 1`);
  lines.push("");
  lines.push(`Файл: \`${meta.file}\``);
  lines.push(
    `Режим: **${result.dryRun ? "DRY-RUN (ничего не записано)" : "COMMIT (записано в БД)"}**`,
  );
  lines.push(`Всё создаётся в статусе \`draft\` — публикует команда после вычитки.`);
  lines.push("");

  lines.push(`## Итоги`);
  lines.push(countLine("Курсы", result.courses));
  lines.push(countLine("Модули", result.modules));
  lines.push(countLine("Уроки", result.lessons));
  lines.push(countLine("Категории вопросов", result.categories));
  lines.push(countLine("Вопросы (банк)", result.questions));
  lines.push(countLine("Вопросы «Проверка себя» (ключевые)", result.keyQuestions));
  lines.push(countLine("Привязки ключевых вопросов (is_key)", result.keyLinks));
  lines.push(countLine("Привязки по «Категориям…» (просто привязан)", result.categoryLinks));
  lines.push(`- Изображения: скопировано ${meta.imagesCopied}, отсутствует ${meta.imagesMissing}`);
  lines.push("");

  const section = (title: string, rows: string[]) => {
    lines.push(`## ${title} (${rows.length})`);
    if (rows.length === 0) lines.push(`_нет_`);
    else for (const row of rows) lines.push(`- ${row}`);
    lines.push("");
  };

  section(
    "Пропущенные разделы",
    a.skippedSections.map((s) => `«${s.title}» — ${s.reason} (строка ${s.line})`),
  );
  section(
    "Созданные не-сидовые корневые категории",
    a.createdNonSeedRootCategories.map((c) => `«${c.title}» (строка ${c.line})`),
  );
  section(
    "Вопросы на уровне подкатегорий (аномалия эвристики)",
    a.questionsAtSubcategoryLevel.map(
      (q) => `«${q.text.slice(0, 80)}» → категория «${q.category}» (строка ${q.line})`,
    ),
  );
  section(
    "Нераспознанные названия категорий из уроков",
    a.unrecognizedCategoryLinks.map(
      (u) => `«${u.name}» в уроке «${u.lessonTitle}» (строка ${u.line})`,
    ),
  );
  section(
    "needs_latex — ответ был только изображением (вычитать формулы в KaTeX)",
    a.needsLatexQuestions.map(
      (q) => `«${q.text.slice(0, 80)}» → «${q.category}» (строка ${q.line})`,
    ),
  );
  section(
    "TODO-изображения (файл не найден — плейсхолдер)",
    a.todoImages.map((t) => `${t.where}: \`${t.path}\` (строка ${t.line})`),
  );

  lines.push(`## Изображения`);
  lines.push(`Скопировано в \`public/media/import/\`: ${plan.images.length}`);
  lines.push("");

  return lines.join("\n");
}
