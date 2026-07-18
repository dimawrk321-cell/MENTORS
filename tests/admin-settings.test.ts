import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRenewalContact,
  RENEWAL_CONTACT_SETTING_KEY,
  upsertAppSetting,
} from "@/lib/services/settings";
import { getStudentReviewSummary } from "@/lib/services/admin-student";
import { DAY_MS } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Stage 10.2 (spec 8.5/19): фоллбэк RENEWAL_CONTACT env→settings, агрегатор
// вкладки «Повторения».

const originalEnv = process.env.RENEWAL_CONTACT;

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  if (originalEnv === undefined) delete process.env.RENEWAL_CONTACT;
  else process.env.RENEWAL_CONTACT = originalEnv;
});

describe("getRenewalContact: app_settings → env фоллбэк", () => {
  it("нет строки в БД → берётся env", async () => {
    process.env.RENEWAL_CONTACT = "https://t.me/env";
    expect(await getRenewalContact(testDb)).toBe("https://t.me/env");
  });

  it("нет строки и env пуст → null", async () => {
    delete process.env.RENEWAL_CONTACT;
    expect(await getRenewalContact(testDb)).toBe(null);
  });

  it("строка в app_settings перекрывает env", async () => {
    process.env.RENEWAL_CONTACT = "https://t.me/env";
    const admin = await createTestUser({ email: "a@t.local", role: "admin" });
    await upsertAppSetting(testDb, {
      actorId: admin.id,
      key: RENEWAL_CONTACT_SETTING_KEY,
      value: "https://t.me/db",
    });
    expect(await getRenewalContact(testDb)).toBe("https://t.me/db");
  });

  it("пустая строка в БД → фоллбэк на env", async () => {
    process.env.RENEWAL_CONTACT = "https://t.me/env";
    const admin = await createTestUser({ email: "a@t.local", role: "admin" });
    await upsertAppSetting(testDb, {
      actorId: admin.id,
      key: RENEWAL_CONTACT_SETTING_KEY,
      value: "",
    });
    expect(await getRenewalContact(testDb)).toBe("https://t.me/env");
  });

  it("upsert настройки пишет аудит", async () => {
    const admin = await createTestUser({ email: "a@t.local", role: "admin" });
    await upsertAppSetting(testDb, {
      actorId: admin.id,
      key: RENEWAL_CONTACT_SETTING_KEY,
      value: "https://t.me/db",
    });
    const audit = await testDb.auditLog.findFirst({ where: { action: "settings.updated" } });
    expect(audit).not.toBeNull();
    expect(audit?.entityId).toBe(RENEWAL_CONTACT_SETTING_KEY);
  });
});

describe("getStudentReviewSummary (агрегатор вкладки Повторения)", () => {
  it("считает статистику и долю again по категориям за 30 дней", async () => {
    const now = new Date("2026-07-20T10:00:00Z");
    const user = await createTestUser({ email: "s@t.local" });
    const category = await testDb.questionCategory.create({
      data: { title: "Метрики", slug: "metrics", colorIndex: 2, order: 0 },
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
    const card = await testDb.srsCard.create({
      data: {
        userId: user.id,
        questionId: question.id,
        step: 0,
        nextReviewAt: new Date("2026-07-20T00:00:00.000Z"),
        addedFrom: "manual",
      },
    });
    // 3 повторения в окне 30 дней: 2× again, 1× good.
    const at = new Date(now.getTime() - DAY_MS);
    await testDb.srsReview.createMany({
      data: [
        { cardId: card.id, grade: "again", prevStep: 0, newStep: 0, reviewedAt: at },
        { cardId: card.id, grade: "again", prevStep: 0, newStep: 0, reviewedAt: at },
        { cardId: card.id, grade: "good", prevStep: 0, newStep: 1, reviewedAt: at },
      ],
    });

    const summary = await getStudentReviewSummary(testDb, user.id, now);
    expect(summary.stats.answeredTotal).toBe(3);
    expect(summary.stats.learnedCount).toBe(0);
    expect(summary.stats.accuracy30).toBeCloseTo(1 / 3, 5);
    expect(summary.lagging).toHaveLength(1);
    expect(summary.lagging[0]).toMatchObject({ id: category.id, total: 3 });
    expect(summary.lagging[0]!.againRate).toBeCloseTo(2 / 3, 5);
  });
});
