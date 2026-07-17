import { beforeEach, describe, expect, it } from "vitest";
import { runDigestJob } from "@/worker/jobs/digest";
import { runStreakRiskJob } from "@/worker/jobs/streak-risk";
import { runYoutubeCheckJob } from "@/worker/jobs/youtube-check";
import { runSessionCleanupJob } from "@/worker/jobs/session-cleanup";
import { runMockRemindersJob } from "@/worker/jobs/mock-reminders";
import { runEmailDispatchJob } from "@/worker/jobs/email-dispatch";
import { sendAccessExpiryReminders } from "@/lib/services/access";
import { dateOnlyUtc, DAY_MS, localDateStr } from "@/lib/utils/dates";
import { createInterviewer, createSlot } from "./helpers/mocks";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Джобы worker (spec 7.15/19): дайджест (окно/раз в день/пустая очередь молчит),
// access 14/3/0 по разу, streak_risk только opt-in, youtubeCheck (unavailable +
// таймаут-устойчивость), sessionCleanup, mock-напоминания, email-очередь.

const MSK = "Europe/Moscow";

beforeEach(async () => {
  await resetDb();
});

async function seedDueCard(userId: string): Promise<void> {
  const category = await testDb.questionCategory.create({
    data: { title: "Cat", slug: `cat-${userId}`, colorIndex: 0, order: 0 },
  });
  const question = await testDb.question.create({
    data: {
      type: "open",
      categoryId: category.id,
      textMd: "Q",
      status: "published",
      difficulty: 1,
    },
  });
  await testDb.srsCard.create({
    data: {
      userId,
      questionId: question.id,
      step: 0,
      nextReviewAt: dateOnlyUtc("2026-07-01"), // явно просрочена
      addedFrom: "manual",
    },
  });
}

describe("digest job (spec 7.15)", () => {
  // 09:05 MSK = 06:05 UTC — попадает в окно digest_time 09:00.
  const now = new Date("2026-07-15T06:05:00Z");

  it("шлёт дайджест в окне, один раз в день", async () => {
    const u = await createTestUser({ email: "d1@test.local", timezone: MSK, digestTime: "09:00" });
    await seedDueCard(u.id);

    expect(await runDigestJob(testDb, now)).toBe(1);
    const first = await testDb.notification.findMany({ where: { userId: u.id, type: "digest" } });
    expect(first).toHaveLength(1);
    expect(first[0]?.body).toMatch(/к повторению/);

    // повторный прогон в том же окне — без второго дайджеста
    expect(await runDigestJob(testDb, new Date("2026-07-15T06:10:00Z"))).toBe(0);
    expect(await testDb.notification.count({ where: { userId: u.id, type: "digest" } })).toBe(1);
  });

  it("пустая очередь молчит", async () => {
    const u = await createTestUser({ email: "d2@test.local", timezone: MSK, digestTime: "09:00" });
    // без карточек
    expect(await runDigestJob(testDb, now)).toBe(0);
    expect(await testDb.notification.count({ where: { userId: u.id } })).toBe(0);
  });

  it("вне окна digest_time не шлёт", async () => {
    const u = await createTestUser({ email: "d3@test.local", timezone: MSK, digestTime: "10:00" });
    await seedDueCard(u.id);
    expect(await runDigestJob(testDb, now)).toBe(0);
    expect(await testDb.notification.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe("access reminders 14/3/0 (spec 7.1.3)", () => {
  it("каждый порог шлётся ровно один раз", async () => {
    const now = new Date("2026-07-15T09:00:00Z");
    const at = (days: number) => new Date(now.getTime() + days * DAY_MS);
    const u14 = await createTestUser({
      email: "e14@test.local",
      timezone: MSK,
      accessUntil: at(14),
    });
    const u3 = await createTestUser({ email: "e3@test.local", timezone: MSK, accessUntil: at(3) });
    const u0 = await createTestUser({ email: "e0@test.local", timezone: MSK, accessUntil: now });
    const u7 = await createTestUser({ email: "e7@test.local", timezone: MSK, accessUntil: at(7) });

    expect(await sendAccessExpiryReminders(testDb, now)).toBe(3);
    expect(await testDb.notification.count({ where: { userId: u14.id, type: "access_14d" } })).toBe(
      1,
    );
    expect(await testDb.notification.count({ where: { userId: u3.id, type: "access_3d" } })).toBe(
      1,
    );
    expect(await testDb.notification.count({ where: { userId: u0.id, type: "access_0d" } })).toBe(
      1,
    );
    expect(await testDb.notification.count({ where: { userId: u7.id } })).toBe(0);

    // повтор в тот же день — без дублей
    expect(await sendAccessExpiryReminders(testDb, now)).toBe(0);
    expect(await testDb.notification.count({ where: { userId: u14.id } })).toBe(1);
  });
});

describe("streak_risk job — только opt-in (spec 7.12)", () => {
  it("шлёт только включившим; молчит по умолчанию", async () => {
    const now = new Date("2026-07-15T17:30:00Z"); // 20:30 MSK, среда
    const yesterday = dateOnlyUtc(localDateStr(new Date("2026-07-14T12:00:00Z"), MSK));

    const optIn = await createTestUser({ email: "r1@test.local", timezone: MSK });
    const off = await createTestUser({ email: "r2@test.local", timezone: MSK });
    for (const u of [optIn, off]) {
      await testDb.streak.create({
        data: { userId: u.id, current: 5, best: 5, lastCountedDate: yesterday },
      });
    }
    await testDb.notificationPref.create({
      data: { userId: optIn.id, type: "streak_risk", inapp: true, email: false },
    });

    expect(await runStreakRiskJob(testDb, now)).toBe(1);
    expect(
      await testDb.notification.count({ where: { userId: optIn.id, type: "streak_risk" } }),
    ).toBe(1);
    expect(await testDb.notification.count({ where: { userId: off.id } })).toBe(0);

    // раз в день
    expect(await runStreakRiskJob(testDb, now)).toBe(0);
  });
});

describe("youtubeCheck job (spec 7.15)", () => {
  async function makePublishedLesson(slug: string, videoUrl: string): Promise<string> {
    const course = await testDb.course.create({
      data: {
        slug: `c-${slug}`,
        title: "C",
        status: "published",
        modules: {
          create: {
            title: "M",
            status: "published",
            lessons: {
              create: { slug, title: "L", status: "published", contentMd: "x", videoUrl },
            },
          },
        },
      },
      include: { modules: { include: { lessons: true } } },
    });
    return course.modules[0]!.lessons[0]!.id;
  }

  it("недоступное видео → video_status=unavailable", async () => {
    const id = await makePublishedLesson("v1", "https://youtube.com/watch?v=aaaaaaaaaaa");
    const res = await runYoutubeCheckJob(testDb, { probe: async () => "unavailable" });
    expect(res).toMatchObject({ checked: 1, unavailable: 1 });
    const lesson = await testDb.lesson.findUnique({ where: { id } });
    expect(lesson?.videoStatus).toBe("unavailable");
    expect(lesson?.videoCheckedAt).not.toBeNull();
  });

  it("таймаут/ошибка пробы → урок пропущен, статус не меняется, джоба не падает", async () => {
    const id = await makePublishedLesson("v2", "https://youtube.com/watch?v=bbbbbbbbbbb");
    const res = await runYoutubeCheckJob(testDb, {
      probe: async () => {
        throw new Error("timeout");
      },
    });
    expect(res).toMatchObject({ checked: 1, skipped: 1, unavailable: 0, ok: 0 });
    const lesson = await testDb.lesson.findUnique({ where: { id } });
    expect(lesson?.videoStatus).toBe("unchecked"); // без изменений
  });

  it("доступное видео → ok", async () => {
    const id = await makePublishedLesson("v3", "https://youtube.com/watch?v=ccccccccccc");
    await runYoutubeCheckJob(testDb, { probe: async () => "ok" });
    const lesson = await testDb.lesson.findUnique({ where: { id } });
    expect(lesson?.videoStatus).toBe("ok");
  });
});

describe("sessionCleanup job (spec 7.15)", () => {
  it("удаляет истёкшее/использованное/старое-revoked, живое оставляет", async () => {
    const now = new Date("2026-07-15T00:00:00Z");
    const u = await createTestUser({ email: "sc@test.local" });
    const inviter = await createTestUser({ email: "inv@test.local", role: "owner" });
    const past = new Date(now.getTime() - DAY_MS);
    const future = new Date(now.getTime() + DAY_MS);
    const longAgo = new Date(now.getTime() - 10 * DAY_MS);

    await testDb.session.createMany({
      data: [
        { userId: u.id, tokenHash: "expired", ip: "1", expiresAt: past },
        { userId: u.id, tokenHash: "valid", ip: "1", expiresAt: future },
        { userId: u.id, tokenHash: "old-revoked", ip: "1", expiresAt: future, revokedAt: longAgo },
      ],
    });
    await testDb.passwordReset.createMany({
      data: [
        { userId: u.id, token: "r-exp", expiresAt: past },
        { userId: u.id, token: "r-used", expiresAt: future, usedAt: now },
        { userId: u.id, token: "r-valid", expiresAt: future },
      ],
    });
    await testDb.invite.createMany({
      data: [
        { email: "x@t", token: "i-exp", invitedById: inviter.id, expiresAt: past },
        {
          email: "y@t",
          token: "i-acc",
          invitedById: inviter.id,
          expiresAt: future,
          acceptedAt: now,
        },
        { email: "z@t", token: "i-valid", invitedById: inviter.id, expiresAt: future },
      ],
    });

    const res = await runSessionCleanupJob(testDb, now);
    expect(res).toEqual({ sessions: 2, resets: 2, invites: 2 });
    expect(await testDb.session.count({ where: { userId: u.id } })).toBe(1);
    expect(await testDb.passwordReset.count()).toBe(1);
    expect(await testDb.invite.count()).toBe(1);
  });
});

describe("mockReminders job (spec 7.8)", () => {
  it("24ч и 1ч по одному разу на бронь", async () => {
    const now = new Date("2026-07-15T09:00:00Z");
    const interviewer = await createInterviewer("mi@test.local");
    const student = await createTestUser({
      email: "ms@test.local",
      timezone: MSK,
      role: "student",
    });

    const slotSoon = await createSlot(
      interviewer.id,
      new Date(now.getTime() + 30 * 60_000),
      "booked",
    );
    const slotDay = await createSlot(
      interviewer.id,
      new Date(now.getTime() + 20 * 60 * 60_000),
      "booked",
    );
    await testDb.booking.create({
      data: {
        slotId: slotSoon.id,
        userId: student.id,
        type: "theory",
        status: "booked",
        roomUrl: "r",
      },
    });
    await testDb.booking.create({
      data: {
        slotId: slotDay.id,
        userId: student.id,
        type: "theory",
        status: "booked",
        roomUrl: "r",
      },
    });

    const res = await runMockRemindersJob(testDb, now);
    // soon-бронь: и 24ч, и 1ч; day-бронь: только 24ч
    expect(res).toEqual({ sent24: 2, sent1: 1 });
    // дедуп: повтор ничего не добавляет
    expect(await runMockRemindersJob(testDb, now)).toEqual({ sent24: 0, sent1: 0 });
    expect(
      await testDb.notification.count({ where: { userId: student.id, type: "mock_24h" } }),
    ).toBe(2);
    expect(
      await testDb.notification.count({ where: { userId: student.id, type: "mock_1h" } }),
    ).toBe(1);
  });
});

describe("тихие часы vs срочные напоминания (§9 acceptance)", () => {
  it("бронь за 40 минут в тихие часы → email не шлётся и не зависает в outbox", async () => {
    const now = new Date("2026-07-15T00:00:00Z"); // 03:00 MSK — тихие часы
    const interviewer = await createInterviewer("mi2@test.local");
    const student = await createTestUser({
      email: "ms2@test.local",
      timezone: MSK,
      role: "student",
    });
    const start = new Date(now.getTime() + 40 * 60_000); // 03:40 MSK
    const slot = await createSlot(interviewer.id, start, "booked");
    await testDb.booking.create({
      data: { slotId: slot.id, userId: student.id, type: "theory", status: "booked", roomUrl: "r" },
    });

    await runMockRemindersJob(testDb, now);
    // и mock_24h, и mock_1h созданы как in-app, но email НЕ поставлен в очередь
    const notes = await testDb.notification.findMany({ where: { userId: student.id } });
    expect(notes.map((n) => n.type).sort()).toEqual(["mock_1h", "mock_24h"]);
    expect(notes.every((n) => n.inApp === true)).toBe(true);
    expect(notes.every((n) => n.emailPending === false)).toBe(true);
    expect(await testDb.notification.count({ where: { emailPending: true } })).toBe(0);

    // emailDispatch ничего не отправляет и ничего не зависает
    expect(await runEmailDispatchJob(testDb, now)).toMatchObject({ sent: 0, skipped: 0 });
  });

  it("emailDispatch пропускает просроченный email (past deadline)", async () => {
    const now = new Date("2026-07-15T09:00:00Z");
    const u = await createTestUser({ email: "ed2@test.local" });
    await testDb.notification.create({
      data: {
        userId: u.id,
        type: "mock_1h",
        title: "Мок",
        body: "…",
        url: "/mocks/x",
        inApp: true,
        emailPending: true,
        scheduledAt: new Date(now.getTime() - 60_000),
        emailDeadline: new Date(now.getTime() - 30_000), // дедлайн в прошлом
      },
    });
    const res = await runEmailDispatchJob(testDb, now);
    expect(res).toMatchObject({ sent: 0, skipped: 1 });
    const n = await testDb.notification.findFirst({ where: { userId: u.id } });
    expect(n?.emailPending).toBe(false); // снят с очереди
    expect(n?.emailSentAt).toBeNull(); // не отправлен
  });
});

describe("emailDispatch job (spec 7.12)", () => {
  it("отправляет готовые письма, будущие — оставляет", async () => {
    const now = new Date("2026-07-15T09:00:00Z");
    const u = await createTestUser({ email: "ed@test.local" });
    await testDb.notification.create({
      data: {
        userId: u.id,
        type: "mock_feedback",
        title: "Фидбек",
        body: "Готов",
        url: "/mocks/x",
        inApp: true,
        emailPending: true,
        scheduledAt: new Date(now.getTime() - 60_000),
      },
    });
    const future = await testDb.notification.create({
      data: {
        userId: u.id,
        type: "access_14d",
        title: "Доступ",
        body: "…",
        url: "/profile",
        inApp: true,
        emailPending: true,
        scheduledAt: new Date(now.getTime() + 60 * 60_000),
      },
    });

    const res = await runEmailDispatchJob(testDb, now);
    expect(res).toMatchObject({ sent: 1, failed: 0 });
    expect(await testDb.notification.count({ where: { emailPending: true } })).toBe(1);
    const stillPending = await testDb.notification.findUnique({ where: { id: future.id } });
    expect(stillPending?.emailPending).toBe(true);
  });
});
