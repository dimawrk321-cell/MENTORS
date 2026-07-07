import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword } from "../lib/utils/password";
import { paletteIndex } from "../lib/utils/crypto";
import { ACCESS_RULES_SETTING_KEY, DEFAULT_ACCESS_RULES_TEXT } from "../lib/services/settings";

// Stage-1 dev seed (spec changelog to 17/18): owner + 2 mentors from SEED_* env
// so a fresh database is loginable. The full seed (tracks, categories, rubrics,
// achievements, demo course, settings) is a stage-13 task.

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
