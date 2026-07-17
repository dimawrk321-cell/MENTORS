import { PrismaClient, type Role, type UserStatus } from "@prisma/client";
import { paletteIndex } from "@/lib/utils/crypto";
import { testDatabaseUrl } from "./db-url";

export const testDb = new PrismaClient({ datasourceUrl: testDatabaseUrl() });

/** Wipes all stage-1..9 tables in FK-safe order. */
export async function resetDb(): Promise<void> {
  // Stage 9 (notifications & announcements) — reference users/announcements.
  await testDb.announcementRead.deleteMany();
  await testDb.announcement.deleteMany();
  await testDb.notificationPref.deleteMany();
  await testDb.notification.deleteMany();
  // Stage 8 (search) — recency index references users/entities.
  await testDb.recentItem.deleteMany();
  // Stage 7 (library & guides) — views/bookmarks reference recordings/guides/users.
  await testDb.recordingView.deleteMany();
  await testDb.bookmark.deleteMany();
  await testDb.recording.deleteMany();
  await testDb.guide.deleteMany();
  // Stage 6 (mocks) — children first (marks/feedback/strikes/waitlist reference
  // bookings/slots/questions/users), then bookings, slots, availability, profiles.
  await testDb.mockQuestionMark.deleteMany();
  await testDb.feedback.deleteMany();
  await testDb.bookingStrike.deleteMany();
  await testDb.waitlist.deleteMany();
  await testDb.booking.deleteMany();
  await testDb.slot.deleteMany();
  await testDb.availabilityException.deleteMany();
  await testDb.availabilityRule.deleteMany();
  await testDb.rubricTemplate.deleteMany();
  await testDb.interviewerProfile.deleteMany();
  await testDb.xpEvent.deleteMany();
  await testDb.streakEvent.deleteMany();
  await testDb.streak.deleteMany();
  await testDb.userAchievement.deleteMany();
  await testDb.achievement.deleteMany();
  await testDb.srsReview.deleteMany();
  await testDb.srsCard.deleteMany();
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
  studyDays?: number[];
  dailyGoalXp?: number;
  isInterviewer?: boolean;
  digestTime?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
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
      ...(input.studyDays ? { studyDays: input.studyDays } : {}),
      ...(input.dailyGoalXp ? { dailyGoalXp: input.dailyGoalXp } : {}),
      ...(input.isInterviewer ? { isInterviewer: true } : {}),
      ...(input.digestTime ? { digestTime: input.digestTime } : {}),
      ...(input.quietHoursStart ? { quietHoursStart: input.quietHoursStart } : {}),
      ...(input.quietHoursEnd ? { quietHoursEnd: input.quietHoursEnd } : {}),
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
