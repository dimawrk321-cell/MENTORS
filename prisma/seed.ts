import { PrismaClient, type Role, type Track } from "@prisma/client";
import { hashPassword } from "../lib/utils/password";
import { paletteIndex } from "../lib/utils/crypto";
import { computeReadingMinutes } from "../lib/utils/markdown";
import { ACCESS_RULES_SETTING_KEY, DEFAULT_ACCESS_RULES_TEXT } from "../lib/services/settings";
import { seedAchievements } from "../lib/services/achievements";

// Dev seed: stage 1 — owner + 2 mentors from SEED_* env (fresh DB is loginable);
// stage 2 — tracks (ds/nlp/ai) + the demo course from spec 18 (1 module,
// 2 lessons covering формула/код/коллауты/видео); stage 3 — the 8 root
// question categories (spec 7.4), 6 demo questions (3 open is_key + 3 closed
// in_quiz) and the demo module test (pool 3 / порог 80 / кулдаун 45).
// The full seed is a stage-13 task.

const prisma = new PrismaClient();

interface SeedUser {
  emailVar: string;
  passwordVar: string;
  nameVar: string;
  defaultName: string;
  role: Role;
  isInterviewer: boolean;
  // DECISION (dev-stand): owner is required (fresh /admin is otherwise
  // unreachable); mentors are optional — absent SEED_MENTOR* env just skips
  // them, so the seed can bring up an owner-only stand and mentors are added
  // later через штатный инвайт-флоу.
  required: boolean;
}

// Spec 2: is_interviewer у Owner и одного ментора (Дима, Егор — spec 1).
const SEED_USERS: SeedUser[] = [
  {
    emailVar: "SEED_OWNER_EMAIL",
    passwordVar: "SEED_OWNER_PASSWORD",
    nameVar: "SEED_OWNER_NAME",
    defaultName: "Дима",
    role: "owner",
    isInterviewer: true,
    required: true,
  },
  {
    emailVar: "SEED_MENTOR1_EMAIL",
    passwordVar: "SEED_MENTOR1_PASSWORD",
    nameVar: "SEED_MENTOR1_NAME",
    defaultName: "Егор",
    role: "mentor",
    isInterviewer: true,
    required: false,
  },
  {
    emailVar: "SEED_MENTOR2_EMAIL",
    passwordVar: "SEED_MENTOR2_PASSWORD",
    nameVar: "SEED_MENTOR2_NAME",
    defaultName: "Ментор",
    role: "mentor",
    isInterviewer: false,
    required: false,
  },
];

async function seedUser(spec: SeedUser): Promise<void> {
  const email = process.env[spec.emailVar]?.trim().toLowerCase();
  const password = process.env[spec.passwordVar];
  const name = process.env[spec.nameVar]?.trim() || spec.defaultName;

  if (!email || !password) {
    if (spec.required) {
      throw new Error(
        `Не заданы ${spec.emailVar} / ${spec.passwordVar} — добавь их в .env (см. .env.example)`,
      );
    }
    console.log(`= ${spec.role} (${spec.emailVar}) не задан — пропущен`);
    return;
  }
  if (password.length < 8) {
    throw new Error(`${spec.passwordVar}: пароль должен быть не короче 8 символов`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Idempotent re-run: role/flags converge, a manually changed password is kept.
    await prisma.user.update({
      where: { email },
      data: { role: spec.role, isInterviewer: spec.isInterviewer, name: existing.name || name },
    });
    console.log(`= ${spec.role} ${email} уже существует — обновлены роль и флаги`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      role: spec.role,
      isInterviewer: spec.isInterviewer,
      status: "active",
      passwordHash: await hashPassword(password),
      avatarColor: paletteIndex(email),
    },
  });
  console.log(`+ ${spec.role} ${email} создан`);
}

// --- Stage 2: demo course + tracks ---

const DEMO_LESSON_1 = `## Зачем эта страница

Демо-урок собирает все механики контента: формулы, код, коллауты, видео,
практику и таблицы. Настоящие курсы приедут через импортер.

:::callout{type="tip"}
Совет: пройди урок до конца и нажми «Завершить урок» — следующий откроется
автоматически (курс идёт в строгом порядке).
:::

## Немного математики

Функция потерь логистической регрессии для одного примера:

$$
L(y, \\hat{p}) = -\\bigl(y \\log \\hat{p} + (1 - y) \\log (1 - \\hat{p})\\bigr)
$$

Инлайн-формулы тоже работают: $\\hat{p} = \\sigma(w^\\top x)$.

:::callout{type="important"}
Важно: в проде считаем потери сразу по батчу — без циклов по объектам.
:::

## Код

\`\`\`python
import numpy as np

def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-z))

def log_loss(y: np.ndarray, p: np.ndarray) -> float:
    eps = 1e-15
    p = np.clip(p, eps, 1 - eps)
    return float(-(y * np.log(p) + (1 - y) * np.log(1 - p)).mean())
\`\`\`

:::callout{type="warning"}
Предупреждение: без клиппинга вероятностей \`log(0)\` уронит обучение.
:::

## Дополнительное видео

:::video{url="https://youtu.be/IHZwWFHWa-w" title="Градиентный спуск наглядно"}
:::

## Практика

:::practice
- [Потренируй логистическую регрессию на игрушечных данных](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html)
- [Задачи на вероятности](https://karpov.courses)
:::

:::callout{type="material"}
- [Глава про линейные модели](https://education.yandex.ru/handbook/ml)
:::
`;

const DEMO_LESSON_2 = `## Матрица ошибок

Прежде чем считать метрики, зафиксируем термины.

| Прогноз \\ Факт | Positive | Negative |
| --- | --- | --- |
| Positive | TP | FP |
| Negative | FN | TN |

## Точность и полнота

$$
\\text{Precision} = \\frac{TP}{TP + FP}, \\qquad \\text{Recall} = \\frac{TP}{TP + FN}
$$

Гармоническое среднее двух метрик — $F_1$-мера.

:::callout{type="tip"}
Выбор метрики — продуктовое решение: сначала пойми цену FP и FN, потом считай.
:::

\`\`\`python numbers
from sklearn.metrics import precision_score, recall_score

precision = precision_score(y_true, y_pred)
recall = recall_score(y_true, y_pred)
\`\`\`
`;

async function seedTracksAndDemoCourse(): Promise<void> {
  const existing = await prisma.course.findUnique({ where: { slug: "demo" } });
  let courseId = existing?.id;

  if (existing) {
    // DECISION: re-runs never clobber content the team may have edited.
    console.log("= демо-курс уже существует — контент не перезаписан");
  } else {
    const now = new Date();
    const course = await prisma.course.create({
      data: {
        slug: "demo",
        title: "Демо",
        description: "Курс для проверки механик платформы: формулы, код, коллауты, видео, гейтинг.",
        gating: "strict",
        status: "published",
        order: 0,
        modules: {
          create: {
            title: "Основной",
            order: 0,
            status: "published",
            lessons: {
              create: [
                {
                  slug: "kak-ustroeno-obuchenie",
                  title: "Как устроено обучение модели",
                  order: 0,
                  status: "published",
                  difficulty: "intro",
                  contentMd: DEMO_LESSON_1,
                  readingMinutes: computeReadingMinutes(DEMO_LESSON_1),
                  videoUrl: "https://youtu.be/aircAruvnKk",
                  publishedAt: now,
                },
                {
                  slug: "metriki-kachestva",
                  title: "Метрики качества: с чего начать",
                  order: 1,
                  status: "published",
                  difficulty: "base",
                  contentMd: DEMO_LESSON_2,
                  readingMinutes: computeReadingMinutes(DEMO_LESSON_2),
                  publishedAt: now,
                },
              ],
            },
          },
        },
      },
    });
    courseId = course.id;
    console.log("+ демо-курс «Демо» (1 модуль, 2 урока)");
  }

  const tracks: Array<{ key: Track; title: string }> = [
    { key: "ds", title: "Data Science" },
    { key: "nlp", title: "NLP" },
    { key: "ai", title: "AI Engineering" },
  ];
  for (const track of tracks) {
    await prisma.trackDef.upsert({
      where: { key: track.key },
      update: {},
      create: { key: track.key, title: track.title, courseIds: courseId ? [courseId] : [] },
    });
  }
  console.log("+ треки ds / nlp / ai");
}

// --- Stage 3: question categories + demo questions + demo module test ---

// Spec 7.4: 8 корневых категорий, цвета по порядку (spec 5.1).
const ROOT_CATEGORIES = [
  "Classic ML",
  "Python",
  "А/Б-тесты и статистика",
  "NLP",
  "Production",
  "RecSys",
  "SQL",
  "ML System Design",
];

const CATEGORY_SLUGS: Record<string, string> = {
  "Classic ML": "classic-ml",
  Python: "python",
  "А/Б-тесты и статистика": "ab-tests-statistics",
  NLP: "nlp",
  Production: "production",
  RecSys: "recsys",
  SQL: "sql",
  "ML System Design": "ml-system-design",
};

async function seedQuestionCategories(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [index, title] of ROOT_CATEGORIES.entries()) {
    const category = await prisma.questionCategory.upsert({
      where: { slug: CATEGORY_SLUGS[title]! },
      update: {},
      create: { title, slug: CATEGORY_SLUGS[title]!, colorIndex: index, order: index },
    });
    ids.set(title, category.id);
  }
  console.log("+ 8 категорий вопросов (spec 7.4)");
  return ids;
}

async function seedDemoQuestions(categoryIds: Map<string, string>): Promise<void> {
  const demoModule = await prisma.module.findFirst({
    where: { course: { slug: "demo" } },
    include: { lessons: { orderBy: { order: "asc" } } },
  });
  if (!demoModule || demoModule.lessons.length < 2) {
    console.log("= демо-курса нет — вопросы и тест пропущены");
    return;
  }
  const [lesson1, lesson2] = demoModule.lessons;

  const linked = await prisma.questionLesson.count({
    where: { lessonId: { in: demoModule.lessons.map((lesson) => lesson.id) } },
  });
  if (linked > 0) {
    console.log("= вопросы демо-курса уже существуют — не перезаписаны");
  } else {
    const classicMl = categoryIds.get("Classic ML")!;
    const python = categoryIds.get("Python")!;

    // 3 open (is_key) + 3 закрытых разных типов (in_quiz) — spec 18.
    const demoQuestions = [
      {
        lessonId: lesson1!.id,
        isKey: true,
        inQuiz: false,
        data: {
          type: "open" as const,
          categoryId: classicMl,
          difficulty: 1,
          textMd: "Что такое функция потерь и зачем она нужна при обучении модели?",
          answerMd:
            "Функция потерь $L(y, \\hat{y})$ измеряет, насколько предсказание расходится с фактом. " +
            "Обучение — это минимизация среднего значения потерь по данным: градиентный спуск " +
            "двигает параметры в сторону антиградиента $-\\nabla_w L$. Без функции потерь у " +
            "оптимизации нет цели.",
        },
      },
      {
        lessonId: lesson1!.id,
        isKey: true,
        inQuiz: false,
        data: {
          type: "open" as const,
          categoryId: python,
          difficulty: 2,
          textMd: "Почему при вычислении log loss вероятности клиппируют (например, `np.clip`)?",
          answerMd:
            "Потому что $\\log(0) = -\\infty$: если модель выдала ровно 0 или 1 и ошиблась, " +
            "потеря становится бесконечной, а градиенты — NaN. Клиппинг в $[\\varepsilon, 1-\\varepsilon]$ " +
            "держит вычисления численно стабильными.",
        },
      },
      {
        lessonId: lesson2!.id,
        isKey: true,
        inQuiz: false,
        data: {
          type: "open" as const,
          categoryId: classicMl,
          difficulty: 1,
          textMd: "Чем precision отличается от recall и когда важнее каждая из метрик?",
          answerMd:
            "$\\text{Precision} = \\frac{TP}{TP+FP}$ — доля верных среди предсказанных положительных; " +
            "$\\text{Recall} = \\frac{TP}{TP+FN}$ — доля найденных среди всех положительных. " +
            "Precision важнее, когда дорог ложный положительный (спам-фильтр), recall — когда дорог " +
            "пропуск (медицинский скрининг).",
        },
      },
      {
        lessonId: lesson1!.id,
        isKey: false,
        inQuiz: true,
        data: {
          type: "single" as const,
          categoryId: classicMl,
          difficulty: 1,
          textMd: "Что вернёт сигмоида $\\sigma(z)$ при $z = 0$?",
          options: [
            { id: "a", text: "0", correct: false },
            { id: "b", text: "0.5", correct: true },
            { id: "c", text: "1", correct: false },
            { id: "d", text: "−1", correct: false },
          ],
          explanationMd:
            "$\\sigma(0) = \\frac{1}{1 + e^{0}} = \\frac{1}{2}$ — сигмоида симметрична вокруг нуля.",
        },
      },
      {
        lessonId: lesson1!.id,
        isKey: false,
        inQuiz: true,
        data: {
          type: "short_text" as const,
          categoryId: classicMl,
          difficulty: 1,
          textMd: "Как называется функция, которая переводит логит в вероятность (одно слово)?",
          acceptedAnswers: ["сигмоида", "sigmoid", "логистическая", "логистическая функция"],
          explanationMd: "Сигмоида (логистическая функция): $\\sigma(z) = \\frac{1}{1+e^{-z}}$.",
        },
      },
      {
        lessonId: lesson2!.id,
        isKey: false,
        inQuiz: true,
        data: {
          type: "tf" as const,
          categoryId: classicMl,
          difficulty: 1,
          textMd: "$F_1$-мера — это гармоническое среднее precision и recall.",
          options: [
            { id: "true", text: "Верно", correct: true },
            { id: "false", text: "Неверно", correct: false },
          ],
          explanationMd:
            "Да: $F_1 = \\frac{2 \\cdot P \\cdot R}{P + R}$ — гармоническое среднее штрафует перекос в одну из метрик.",
        },
      },
    ];

    for (const item of demoQuestions) {
      const question = await prisma.question.create({
        data: { ...item.data, status: "published", source: "manual" },
      });
      await prisma.questionLesson.create({
        data: {
          questionId: question.id,
          lessonId: item.lessonId,
          isKey: item.isKey,
          inQuiz: item.inQuiz,
        },
      });
    }
    console.log("+ 6 демо-вопросов (3 open is_key, 3 закрытых in_quiz)");
  }

  await prisma.moduleTest.upsert({
    where: { moduleId: demoModule.id },
    update: {},
    create: {
      moduleId: demoModule.id,
      poolSize: 3,
      threshold: 80,
      cooldownMinutes: 45,
      enabled: true,
    },
  });
  console.log("+ тест демо-модуля (3 вопроса, порог 80%, кулдаун 45 мин)");
}

async function main(): Promise<void> {
  for (const spec of SEED_USERS) {
    await seedUser(spec);
  }

  await prisma.appSetting.upsert({
    where: { key: ACCESS_RULES_SETTING_KEY },
    update: {},
    create: { key: ACCESS_RULES_SETTING_KEY, value: DEFAULT_ACCESS_RULES_TEXT },
  });
  console.log("+ app_settings: текст правил доступа");

  await seedTracksAndDemoCourse();
  const categoryIds = await seedQuestionCategories();
  await seedDemoQuestions(categoryIds);

  // Stage 5: справочник достижений (spec 7.7) — сидится из ACHIEVEMENTS.
  await seedAchievements(prisma);
  console.log("+ справочник достижений (spec 7.7)");

  console.log("Dev-seed готов.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
