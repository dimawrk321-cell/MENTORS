import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";
import { buildLessonAggregate } from "@/lib/utils/lesson-aggregate";
import { computeReadingMinutes } from "@/lib/utils/markdown";

// Точечная починка наблюдаемого мусора в агрегате шагов (заход C.10).
//
// Что чинится и почему — фактами, снятыми со стенда read-only:
//
// 1. ПЕРЕСБОРКА АГРЕГАТА. Прежняя `syncLessonAggregate` подставляла название
//    шага заголовком (`## {title}`) в `lessons.content_md` — колонку, которую
//    индексирует FTS, рендерит предпросмотр и грепают директивы. Названия шагов
//    больше в проекцию не идут, но уже записанные заголовки сами не уйдут:
//    пересборка нужна разовым прогоном.
//
// 2. ЧУЖОЕ НАЗВАНИЕ ШАГА. У урока «Урок 1. Языковые модели» единственный шаг
//    называется «Урок 2. Классические языковые модели: Backoff, Smoothing и
//    Kneser–Ney», а его текст — материал самого «Урока 1» («# Языковые модели и
//    генерация текста»). По аудит-логу: 26.08 07:26 в урок скопировали «Урок 2»
//    (`lesson_steps.copied_from_lessons`), 27.08 11:52 и 11:55 удалили два своих
//    шага, а в оставшуюся копию вложили текст «Урока 1» — название осталось
//    чужим. Ученику оно не видно (при одном шаге навигатор не рисуется), но оно
//    попадало в `content_md` заголовком и остаётся в дереве студии.
//
// Карта — ЯВНАЯ, как в `apply-python-answers.ts`: у каждой правки контрольный
// фрагмент (`expect*`), при расхождении прогон падает целиком и ничего не пишет.
// Скрипт ничего не угадывает и не ищет «похожие» шаги.
//
// Одна запись в аудит на прогон.
//
// Порядок запуска: сначала выкатить код захода (пересборка обязана идти той же
// функцией `buildLessonAggregate`, что и сервис, — второго определения проекции
// не заводим), затем прогнать здесь.
//
// Run:
//   pnpm exec tsx scripts/fix-lesson-step-aggregate.ts --dry-run
//   pnpm exec tsx scripts/fix-lesson-step-aggregate.ts --commit

interface StepRename {
  stepId: string;
  /** Фрагмент текущего названия — защита от дрейфа id. */
  expectTitle: string;
  /** Фрагмент содержимого шага — доказательство, что название и правда чужое. */
  expectContent: string;
  title: string;
}

/** Переименования шагов. Пусто = только пересборка агрегатов. */
const STEP_RENAMES: StepRename[] = [
  {
    stepId: "cmt9rt7mk00jiqs014y3q5lvt",
    expectTitle: "Урок 2. Классические языковые модели",
    expectContent: "# Языковые модели и генерация текста",
    title: "Материал",
  },
];

/**
 * Уроки, чей агрегат пересобирается. Явный список: пересобирать всё подряд
 * незачем, шаги есть у четырёх уроков платформы.
 */
const LESSON_IDS: string[] = [
  "cmt2xwc1e00fwph01hn710aug", // Python + PyTorch · PyTorch (13 шагов)
  "cmszsnjkb0031la014uufgkh2", // Python + PyTorch · Введение в Python
  "cmruiof4q0002ur3cy90za3b3", // Знакомство с PRIME · Как устроена платформа
  "cmt2pqzuu001rph01inmi9fud", // NLP: базовый курс · Урок 1. Языковые модели
];

function oneLine(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const dryRun = args.includes("--dry-run");
  if (commit === dryRun) throw new Error("нужен ровно один из --dry-run | --commit");

  console.log(
    `Режим: ${commit ? "COMMIT" : "dry-run"} · переименований: ${STEP_RENAMES.length} · ` +
      `уроков к пересборке: ${LESSON_IDS.length}\n`,
  );

  // --- 1. Переименования шагов -------------------------------------------
  const renames: Array<{ plan: StepRename; before: string }> = [];
  for (const plan of STEP_RENAMES) {
    const step = await prisma.lessonStep.findUnique({
      where: { id: plan.stepId },
      select: { id: true, title: true, contentMd: true, lesson: { select: { title: true } } },
    });
    if (!step) throw new Error(`шаг ${plan.stepId} не найден`);
    if (!step.title.includes(plan.expectTitle)) {
      throw new Error(
        `шаг ${plan.stepId}: контрольный фрагмент названия не совпал\n` +
          `  ожидали: ${JSON.stringify(plan.expectTitle)}\n  в базе:  ${JSON.stringify(step.title)}`,
      );
    }
    if (!step.contentMd.includes(plan.expectContent)) {
      throw new Error(
        `шаг ${plan.stepId}: контрольный фрагмент содержимого не совпал\n` +
          `  ожидали: ${JSON.stringify(plan.expectContent)}`,
      );
    }
    if (step.title === plan.title) {
      console.log(`— шаг ${plan.stepId}: название уже «${plan.title}», пропуск`);
      continue;
    }
    renames.push({ plan, before: step.title });
    console.log(
      `ШАГ ${plan.stepId} · урок «${step.lesson.title}»\n` +
        `  было:  ${JSON.stringify(step.title)}\n` +
        `  стало: ${JSON.stringify(plan.title)}\n` +
        `  текст шага начинается с: ${JSON.stringify(oneLine(step.contentMd, 90))}\n`,
    );
  }

  // --- 2. Пересборка агрегатов -------------------------------------------
  const renameById = new Map(renames.map((item) => [item.plan.stepId, item.plan.title]));
  const rebuilds: Array<{
    id: string;
    title: string;
    before: string;
    after: string;
    beforeMinutes: number;
    afterMinutes: number;
  }> = [];

  for (const lessonId of LESSON_IDS) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: {
        id: true,
        title: true,
        contentMd: true,
        readingMinutes: true,
        steps: {
          where: { status: "published" },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          select: { id: true, title: true, contentMd: true },
        },
      },
    });
    if (!lesson) throw new Error(`урок ${lessonId} не найден`);
    // Переименование название из проекции не убирает (его там больше нет вовсе),
    // но применяем его к снимку, чтобы отчёт показывал итоговое состояние.
    const steps = lesson.steps.map((step) => ({
      ...step,
      title: renameById.get(step.id) ?? step.title,
    }));
    const after = buildLessonAggregate(steps);
    if (!after)
      throw new Error(`урок ${lessonId}: пересборка дала пустой агрегат — прогон отменён`);
    if (after === lesson.contentMd) {
      console.log(`— урок «${lesson.title}»: агрегат уже чистый, пропуск`);
      continue;
    }
    const afterMinutes = computeReadingMinutes(after);
    rebuilds.push({
      id: lesson.id,
      title: lesson.title,
      before: lesson.contentMd,
      after,
      beforeMinutes: lesson.readingMinutes,
      afterMinutes,
    });
    console.log(
      `УРОК «${lesson.title}» (${lesson.id}) · шагов опубликовано: ${steps.length}\n` +
        `  было:  ${lesson.contentMd.length} симв. · ${lesson.readingMinutes} мин\n` +
        `         ${JSON.stringify(oneLine(lesson.contentMd))}\n` +
        `  стало: ${after.length} симв. · ${afterMinutes} мин\n` +
        `         ${JSON.stringify(oneLine(after))}\n`,
    );
  }

  console.log(
    `Итого: переименований ${renames.length} · пересборок ${rebuilds.length} · ` +
      `символов ${rebuilds.reduce((s, r) => s + r.before.length, 0)} → ` +
      `${rebuilds.reduce((s, r) => s + r.after.length, 0)}`,
  );

  if (!commit) {
    console.log("\ndry-run: база не тронута.");
    return;
  }
  if (renames.length === 0 && rebuilds.length === 0) {
    console.log("\ncommit: менять нечего, база не тронута.");
    return;
  }

  const owner = await prisma.user.findFirst({ where: { role: "owner" }, select: { id: true } });
  if (!owner) throw new Error("не найден owner для записи в аудит");

  await prisma.$transaction(async (tx) => {
    for (const item of renames) {
      await tx.lessonStep.update({
        where: { id: item.plan.stepId },
        data: { title: item.plan.title },
      });
    }
    for (const item of rebuilds) {
      // `content_updated_at` НЕ трогаем — это не смысловая правка текста, а
      // снятие служебных заголовков (тот же принцип, что у
      // `scripts/normalize-imported-md.ts`, заход 12.3). Иначе все прошедшие
      // ученики получили бы бейдж «урок обновлён» на пустом месте.
      await tx.lesson.update({
        where: { id: item.id },
        data: { contentMd: item.after, readingMinutes: item.afterMinutes },
      });
    }
    await writeAudit(tx, {
      actorId: owner.id,
      action: "lesson_steps.aggregate_repaired",
      entityType: "lesson",
      entityId: "batch:lesson-step-aggregate",
      before: {
        renamedSteps: renames.map((item) => ({ id: item.plan.stepId, title: item.before })),
        lessons: rebuilds.map((item) => ({
          id: item.id,
          chars: item.before.length,
          readingMinutes: item.beforeMinutes,
        })),
      },
      after: {
        renamedSteps: renames.map((item) => ({ id: item.plan.stepId, title: item.plan.title })),
        lessons: rebuilds.map((item) => ({
          id: item.id,
          chars: item.after.length,
          readingMinutes: item.afterMinutes,
        })),
      },
    });
  });

  console.log("\ncommit: агрегаты пересобраны, одна запись в аудит.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
