import { PrismaClient, type Role, type Track } from "@prisma/client";
import { hashPassword } from "../lib/utils/password";
import { paletteIndex } from "../lib/utils/crypto";
import { ACCESS_RULES_SETTING_KEY, LEVEL_TITLES_SETTING_KEY } from "../lib/services/settings";
import { DEFAULT_ACCESS_RULES_TEXT } from "../lib/services/settings";
import { DEFAULT_LEVEL_TITLES } from "../lib/services/level-titles";
import { seedAchievements } from "../lib/services/achievements";
import { seedRubricTemplates } from "../lib/services/feedback";
import { ensureWelcomeCourse, pinWelcomeFirstInTracks } from "../lib/services/welcome-course";
import { ROOM_URL_PLACEHOLDER } from "../lib/constants";

// Final seed (spec 18, walk 13.2 block 4): a fresh DB boots a working platform
// first time. Owner (+ optional mentors) from SEED_* env; tracks ds/nlp/ai with
// the welcome course «Знакомство с MENTORS» pinned first (draft — owner reads
// through and publishes); the 8 root question categories (spec 7.4); the
// achievements catalog (7.7); rubric templates (7.8); app_settings defaults
// (access-rules text, level-title ladder). Real content arrives via the
// importer (7.14) — the old demo course is gone from the seed (walk 13.2;
// existing DBs are untouched, the seed only adds what is missing).

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

// --- Tracks + welcome course (spec 18 / walk 13.2 block 4) ---

async function seedTracksAndWelcomeCourse(): Promise<void> {
  const welcomeId = await ensureWelcomeCourse(prisma);

  const tracks: Array<{ key: Track; title: string }> = [
    { key: "ds", title: "Data Science" },
    { key: "nlp", title: "NLP" },
    { key: "ai", title: "AI Engineering" },
  ];
  for (const track of tracks) {
    await prisma.trackDef.upsert({
      where: { key: track.key },
      update: {},
      create: { key: track.key, title: track.title, courseIds: [welcomeId] },
    });
  }
  // Pre-existing tracks (an already-lived DB) get welcome prepended, not clobbered.
  await pinWelcomeFirstInTracks(prisma, welcomeId);
  console.log("+ треки ds / nlp / ai + welcome-курс первым (draft — публикует владелец)");
}

// --- Question categories (spec 7.4) ---

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

async function seedQuestionCategories(): Promise<void> {
  for (const [index, title] of ROOT_CATEGORIES.entries()) {
    await prisma.questionCategory.upsert({
      where: { slug: CATEGORY_SLUGS[title]! },
      update: {},
      create: { title, slug: CATEGORY_SLUGS[title]!, colorIndex: index, order: index },
    });
  }
  console.log("+ 8 категорий вопросов (spec 7.4)");
}

// --- Stage 6: interviewer profiles + rubric templates (spec 7.8/18) ---

async function seedInterviewerProfiles(): Promise<void> {
  const interviewers = await prisma.user.findMany({ where: { isInterviewer: true } });
  for (const interviewer of interviewers) {
    // DECISION (spec 7.8/task): room_url starts as a placeholder — the interviewer
    // replaces it with a real Телемост link in their cabinet. Re-runs never
    // clobber an already-edited URL.
    await prisma.interviewerProfile.upsert({
      where: { userId: interviewer.id },
      update: {},
      create: {
        userId: interviewer.id,
        roomUrl: ROOM_URL_PLACEHOLDER,
        active: true,
      },
    });
  }
  if (interviewers.length > 0) {
    console.log(`+ профили интервьюеров (${interviewers.length}) с плейсхолдер room_url`);
  }
}

async function main(): Promise<void> {
  for (const spec of SEED_USERS) {
    await seedUser(spec);
  }
  await seedInterviewerProfiles();

  await prisma.appSetting.upsert({
    where: { key: ACCESS_RULES_SETTING_KEY },
    update: {},
    create: { key: ACCESS_RULES_SETTING_KEY, value: DEFAULT_ACCESS_RULES_TEXT },
  });
  console.log("+ app_settings: текст правил доступа");

  // DECISION (walk 13.2 block 4): the level-title ladder (spec 13.1/D7) is
  // pinned into app_settings so /admin/settings edits and the runtime read the
  // same data source from day one. Other numeric settings (XP map, operational
  // rules) intentionally stay UNSEEDED — absent row = live code default, so
  // future default changes propagate without a data migration.
  await prisma.appSetting.upsert({
    where: { key: LEVEL_TITLES_SETTING_KEY },
    update: {},
    create: {
      key: LEVEL_TITLES_SETTING_KEY,
      value: DEFAULT_LEVEL_TITLES.map((entry) => ({
        minLevel: entry.minLevel,
        title: entry.title,
      })),
    },
  });
  console.log("+ app_settings: лестница титулов уровней (spec 13.1/D7)");

  await seedTracksAndWelcomeCourse();
  await seedQuestionCategories();

  // Stage 5: справочник достижений (spec 7.7) — сидится из ACHIEVEMENTS.
  await seedAchievements(prisma);
  console.log("+ справочник достижений (spec 7.7)");

  // Stage 6: дефолтные рубрики фидбека (spec 7.8).
  await seedRubricTemplates(prisma);
  console.log("+ рубрики фидбека theory/legend (spec 7.8)");

  console.log("Сид готов: платформа поднимается с первого раза (spec 18).");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
