import { PrismaClient, type Role, type Track } from "@prisma/client";
import { hashPassword } from "../lib/utils/password";
import { paletteIndex } from "../lib/utils/crypto";
import { computeReadingMinutes } from "../lib/utils/markdown";
import { ACCESS_RULES_SETTING_KEY, DEFAULT_ACCESS_RULES_TEXT } from "../lib/services/settings";

// Dev seed: stage 1 — owner + 2 mentors from SEED_* env (fresh DB is loginable);
// stage 2 — tracks (ds/nlp/ai) + the demo course from spec 18 (1 module,
// 2 lessons covering формула/код/коллауты/видео) so every content mechanic can
// be exercised by hand. The full seed is a stage-13 task.

const prisma = new PrismaClient();

interface SeedUser {
  emailVar: string;
  passwordVar: string;
  nameVar: string;
  defaultName: string;
  role: Role;
  isInterviewer: boolean;
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
  },
  {
    emailVar: "SEED_MENTOR1_EMAIL",
    passwordVar: "SEED_MENTOR1_PASSWORD",
    nameVar: "SEED_MENTOR1_NAME",
    defaultName: "Егор",
    role: "mentor",
    isInterviewer: true,
  },
  {
    emailVar: "SEED_MENTOR2_EMAIL",
    passwordVar: "SEED_MENTOR2_PASSWORD",
    nameVar: "SEED_MENTOR2_NAME",
    defaultName: "Ментор",
    role: "mentor",
    isInterviewer: false,
  },
];

async function seedUser(spec: SeedUser): Promise<void> {
  const email = process.env[spec.emailVar]?.trim().toLowerCase();
  const password = process.env[spec.passwordVar];
  const name = process.env[spec.nameVar]?.trim() || spec.defaultName;

  if (!email || !password) {
    throw new Error(
      `Не заданы ${spec.emailVar} / ${spec.passwordVar} — добавь их в .env (см. .env.example)`,
    );
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
