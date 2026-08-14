import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/services/audit";

// Три точечные правки банка, найденные при сверке эталонов Python (заход
// «Эталоны Python»). Решения владельца, эвристик здесь нет:
//
//   1. «Какие существуют способы взаимодействия микросервисов…» лежит прямо в
//      КОРНЕВОЙ категории «Python» вместо подкатегории «Контейнеризация и
//      архитектура» — недосмотр импорта.
//   2. «воспроизведи баг с изменяемым аргументом…» опубликован с эталоном из
//      двух букв («ва») и помечен ключевым для урока «Функции и их особенности
//      в Python», то есть показывается ученику карточкой без обратной стороны.
//      Снимаем С ПУБЛИКАЦИИ целиком (не только роль): пока эталона нет, вопросу
//      в выдаче делать нечего. Привязка остаётся — редактор урока сам покажет
//      ментору «Привязано черновиков: 1».
//   3. «Почему при вычислении log loss вероятности клиппируют» — ML-вопрос в
//      Python-ветке. Целевую категорию скрипт НЕ угадывает: без
//      `--logloss-category=<id>` пункт пропускается.
//
// Актор аудита — owner: правки выполняет скрипт, а не человек в интерфейсе.
// Владелец это принял осознанно (альтернатива — оставить стенд неисправленным).
//
// Run:  pnpm exec tsx scripts/fix-question-placement.ts --dry-run
//       pnpm exec tsx scripts/fix-question-placement.ts --commit [--logloss-category=<id>]

const MICROSERVICES_ID = "cmrlybt8z009zur7w3tusywer";
const CONTAINERIZATION_CATEGORY_ID = "cmrlybmjc001fur7w3jl34n8w";
const STUB_ANSWER_ID = "cmrlyc14z00n6ur7wibcglgtn";
const LOGLOSS_ID = "cmrly79el000mqi1wzre4qraq";

/** Значения для аудита: колонки before/after — Prisma Json. */
type AuditPatch = Record<string, string>;

interface Step {
  label: string;
  before: AuditPatch;
  after: AuditPatch;
  apply: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<void>;
  entityId: string;
  action: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const dryRun = args.includes("--dry-run");
  if (commit === dryRun) throw new Error("нужен ровно один из --dry-run | --commit");
  const loglossArg = args.find((a) => a.startsWith("--logloss-category="));
  const loglossCategoryId = loglossArg?.slice("--logloss-category=".length);

  const steps: Step[] = [];
  const skipped: string[] = [];

  // --- 1. Микросервисы → «Контейнеризация и архитектура» ---
  const micro = await prisma.question.findUnique({
    where: { id: MICROSERVICES_ID },
    select: { id: true, categoryId: true, textMd: true },
  });
  const target = await prisma.questionCategory.findUnique({
    where: { id: CONTAINERIZATION_CATEGORY_ID },
    select: { id: true, title: true },
  });
  if (!micro) throw new Error(`вопрос ${MICROSERVICES_ID} не найден`);
  if (!target) throw new Error(`категория ${CONTAINERIZATION_CATEGORY_ID} не найдена`);
  if (!micro.textMd.includes("микросервис")) {
    throw new Error(`${MICROSERVICES_ID}: текст вопроса изменился, проверь карту`);
  }
  if (micro.categoryId === target.id) {
    skipped.push("1. Микросервисы уже в «Контейнеризация и архитектура»");
  } else {
    const from = await prisma.questionCategory.findUnique({
      where: { id: micro.categoryId },
      select: { title: true },
    });
    steps.push({
      label: `1. Микросервисы: категория «${from?.title ?? micro.categoryId}» → «${target.title}»`,
      before: { categoryId: micro.categoryId },
      after: { categoryId: target.id },
      entityId: micro.id,
      action: "question.category_changed",
      apply: async (tx) => {
        await tx.question.update({ where: { id: micro.id }, data: { categoryId: target.id } });
      },
    });
  }

  // --- 2. Вопрос-заглушка «ва» → снять с публикации ---
  const stub = await prisma.question.findUnique({
    where: { id: STUB_ANSWER_ID },
    select: { id: true, status: true, answerMd: true, textMd: true },
  });
  if (!stub) throw new Error(`вопрос ${STUB_ANSWER_ID} не найден`);
  if (!stub.textMd.includes("воспроизведи баг")) {
    throw new Error(`${STUB_ANSWER_ID}: текст вопроса изменился, проверь карту`);
  }
  if (stub.status !== "published") {
    skipped.push(`2. Вопрос-заглушка уже не опубликован (${stub.status})`);
  } else {
    steps.push({
      label:
        `2. Вопрос-заглушка: published → draft ` +
        `(эталон сейчас ${JSON.stringify(stub.answerMd)}, ${stub.answerMd?.length ?? 0} симв.)`,
      before: { status: stub.status },
      after: { status: "draft" },
      entityId: stub.id,
      action: "question.unpublished",
      apply: async (tx) => {
        await tx.question.update({ where: { id: stub.id }, data: { status: "draft" } });
      },
    });
  }

  // --- 3. log loss → категория по выбору владельца ---
  const logloss = await prisma.question.findUnique({
    where: { id: LOGLOSS_ID },
    select: { id: true, categoryId: true, textMd: true },
  });
  if (!logloss) throw new Error(`вопрос ${LOGLOSS_ID} не найден`);
  if (!loglossCategoryId) {
    skipped.push("3. log loss: категория не задана (--logloss-category=<id>) — пропущен");
  } else {
    const dest = await prisma.questionCategory.findUnique({
      where: { id: loglossCategoryId },
      select: { id: true, title: true, parentId: true },
    });
    if (!dest) throw new Error(`категория ${loglossCategoryId} не найдена`);
    if (logloss.categoryId === dest.id) {
      skipped.push(`3. log loss уже в «${dest.title}»`);
    } else {
      const from = await prisma.questionCategory.findUnique({
        where: { id: logloss.categoryId },
        select: { title: true },
      });
      steps.push({
        label: `3. log loss: категория «${from?.title ?? logloss.categoryId}» → «${dest.title}»`,
        before: { categoryId: logloss.categoryId },
        after: { categoryId: dest.id },
        entityId: logloss.id,
        action: "question.category_changed",
        apply: async (tx) => {
          await tx.question.update({ where: { id: logloss.id }, data: { categoryId: dest.id } });
        },
      });
    }
  }

  console.log(`Режим: ${commit ? "COMMIT" : "dry-run"}\n`);
  for (const s of steps) console.log("  → " + s.label);
  for (const s of skipped) console.log("  · пропущено: " + s);
  if (steps.length === 0) {
    console.log("\nДелать нечего.");
    return;
  }
  if (!commit) {
    console.log("\ndry-run: база не тронута.");
    return;
  }

  const owner = await prisma.user.findFirst({ where: { role: "owner" }, select: { id: true } });
  if (!owner) throw new Error("не найден owner для записи в аудит");

  await prisma.$transaction(async (tx) => {
    for (const s of steps) {
      await s.apply(tx);
      await writeAudit(tx, {
        actorId: owner.id,
        action: s.action,
        entityType: "question",
        entityId: s.entityId,
        before: s.before,
        after: s.after,
      });
    }
  });
  console.log(`\ncommit: применено шагов ${steps.length}, по записи в аудит на каждый.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
