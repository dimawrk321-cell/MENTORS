import { PrismaClient, type Role, type UserStatus } from "@prisma/client";
import { paletteIndex } from "@/lib/utils/crypto";
import { testDatabaseUrl } from "./db-url";

export const testDb = new PrismaClient({ datasourceUrl: testDatabaseUrl() });

/** Wipes all stage-1/2/3 tables in FK-safe order. */
export async function resetDb(): Promise<void> {
  await testDb.quizAnswer.deleteMany();
  await testDb.testAttemptAnswer.deleteMany();
  await testDb.testAttempt.deleteMany();
  await testDb.questionLesson.deleteMany();
  await testDb.moduleTest.deleteMany();
  await testDb.contentReport.deleteMany();
  await testDb.question.deleteMany();
  await testDb.questionCategory.deleteMany();
  await testDb.lessonProgress.deleteMany();
  await testDb.lesson.deleteMany();
  await testDb.module.deleteMany();
  await testDb.course.deleteMany();
  await testDb.trackDef.deleteMany();
  await testDb.analyticsEvent.deleteMany();
  await testDb.auditLog.deleteMany();
  await testDb.securityFlag.deleteMany();
  await testDb.accessExtension.deleteMany();
  await testDb.passwordReset.deleteMany();
  await testDb.session.deleteMany();
  await testDb.device.deleteMany();
  await testDb.invite.deleteMany();
  await testDb.authAttempt.deleteMany();
  await testDb.appSetting.deleteMany();
  await testDb.user.deleteMany();
}

interface TestUserInput {
  email: string;
  role?: Role;
  status?: UserStatus;
  passwordHash?: string | null;
  accessUntil?: Date | null;
  activatedAt?: Date | null;
  name?: string;
  timezone?: string;
}

export async function createTestUser(input: TestUserInput) {
  return testDb.user.create({
    data: {
      email: input.email,
      name: input.name ?? "Тестовый Пользователь",
      role: input.role ?? "student",
      status: input.status ?? "active",
      passwordHash: input.passwordHash ?? null,
      accessUntil: input.accessUntil ?? null,
      activatedAt: input.activatedAt ?? null,
      timezone: input.timezone ?? "Europe/Moscow",
      avatarColor: paletteIndex(input.email),
    },
  });
}

export const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
};
