import { beforeEach, describe, expect, it } from "vitest";
import { computeRedFlags, computeWeeklyMetrics } from "@/lib/services/admin-dashboard";
import { DAY_MS } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Пульт-агрегаторы (spec 8.5/19): пропали 7+ дней (с учётом TZ), 3 провала теста
// подряд (именно подряд), доступ истекает ≤14. + метрики недели.

const now = new Date("2026-07-20T10:00:00Z");

beforeEach(async () => {
  await resetDb();
});

async function setLastSeen(userId: string, at: Date | null): Promise<void> {
  await testDb.user.update({ where: { id: userId }, data: { lastSeenAt: at } });
}

describe("Пропали 7+ дней (учёт TZ)", () => {
  it("считает разрыв в календарных днях TZ пользователя", async () => {
    // Один и тот же инстант lastSeen: в MSK это 6 дней назад (не флаг),
    // в UTC — 7 дней (флаг). Доказывает, что окно считается в TZ ученика.
    const sameInstant = new Date("2026-07-13T22:30:00Z");
    const msk = await createTestUser({ email: "msk@t.local", timezone: "Europe/Moscow" });
    const utc = await createTestUser({ email: "utc@t.local", timezone: "UTC" });
    const gone = await createTestUser({ email: "gone@t.local", timezone: "Europe/Moscow" });
    const active = await createTestUser({ email: "active@t.local", timezone: "Europe/Moscow" });
    await setLastSeen(msk.id, sameInstant);
    await setLastSeen(utc.id, sameInstant);
    await setLastSeen(gone.id, new Date(now.getTime() - 20 * DAY_MS));
    await setLastSeen(active.id, new Date(now.getTime() - 2 * DAY_MS));

    const flags = await computeRedFlags(testDb, now);
    const ids = flags.missing.map((s) => s.id);
    expect(ids).toContain(utc.id); // 7 дней в UTC
    expect(ids).toContain(gone.id);
    expect(ids).not.toContain(msk.id); // те же сутки, но в MSK — 6 дней
    expect(ids).not.toContain(active.id);
  });

  it("активный ученик без визитов вовсе — во флаге", async () => {
    const never = await createTestUser({ email: "never@t.local" });
    await setLastSeen(never.id, null);
    const flags = await computeRedFlags(testDb, now);
    expect(flags.missing.map((s) => s.id)).toContain(never.id);
  });
});

describe("3 провала теста подряд (именно подряд)", () => {
  async function makeModule(): Promise<string> {
    const course = await testDb.course.create({
      data: {
        slug: "c",
        title: "C",
        status: "published",
        modules: { create: { title: "M", status: "published" } },
      },
      include: { modules: true },
    });
    return course.modules[0]!.id;
  }

  async function attempt(userId: string, moduleId: string, passed: boolean, dayOffset: number) {
    await testDb.testAttempt.create({
      data: {
        userId,
        moduleId,
        kind: "module",
        questionIds: [],
        passed,
        score: passed ? 90 : 40,
        finishedAt: new Date(now.getTime() - dayOffset * DAY_MS),
      },
    });
  }

  it("флагует только последние-3-провала, не любые 3 провала", async () => {
    const moduleId = await makeModule();
    const fail3 = await createTestUser({ email: "fail3@t.local" });
    const mixed = await createTestUser({ email: "mixed@t.local" });
    const recovered = await createTestUser({ email: "recovered@t.local" });
    const two = await createTestUser({ email: "two@t.local" });

    // fail3: три последних провала подряд
    await attempt(fail3.id, moduleId, false, 3);
    await attempt(fail3.id, moduleId, false, 2);
    await attempt(fail3.id, moduleId, false, 1);
    // mixed: провал-сдача-провал (среди последних 3 есть сдача)
    await attempt(mixed.id, moduleId, false, 3);
    await attempt(mixed.id, moduleId, true, 2);
    await attempt(mixed.id, moduleId, false, 1);
    // recovered: три провала, но самый свежий — сдача
    await attempt(recovered.id, moduleId, false, 4);
    await attempt(recovered.id, moduleId, false, 3);
    await attempt(recovered.id, moduleId, false, 2);
    await attempt(recovered.id, moduleId, true, 1);
    // two: всего два провала
    await attempt(two.id, moduleId, false, 2);
    await attempt(two.id, moduleId, false, 1);

    const flags = await computeRedFlags(testDb, now);
    const ids = flags.failingThree.map((s) => s.id);
    expect(ids).toEqual([fail3.id]);
  });
});

describe("Доступ истекает ≤14 дней", () => {
  it("включает окно [сейчас, +14], исключает дальше и прошедшее", async () => {
    const a = await createTestUser({
      email: "a@t.local",
      accessUntil: new Date(now.getTime() + 10 * DAY_MS),
    });
    const edge = await createTestUser({
      email: "edge@t.local",
      accessUntil: new Date(now.getTime() + 14 * DAY_MS),
    });
    const far = await createTestUser({
      email: "far@t.local",
      accessUntil: new Date(now.getTime() + 20 * DAY_MS),
    });
    const past = await createTestUser({
      email: "past@t.local",
      accessUntil: new Date(now.getTime() - DAY_MS),
    });

    const flags = await computeRedFlags(testDb, now);
    const ids = flags.expiring.map((s) => s.id).sort();
    expect(ids).toEqual([a.id, edge.id].sort());
    expect(ids).not.toContain(far.id);
    expect(ids).not.toContain(past.id);
  });
});

describe("Метрики недели с дельтой", () => {
  it("считает текущее и прошлое окно и разницу", async () => {
    const student = await createTestUser({ email: "s@t.local" });
    // 2 завершения на этой неделе, 1 — на прошлой.
    await testDb.analyticsEvent.createMany({
      data: [
        {
          type: "lesson.completed",
          payload: {},
          userId: student.id,
          createdAt: new Date(now.getTime() - 2 * DAY_MS),
        },
        {
          type: "lesson.completed",
          payload: {},
          userId: student.id,
          createdAt: new Date(now.getTime() - 3 * DAY_MS),
        },
        {
          type: "lesson.completed",
          payload: {},
          userId: student.id,
          createdAt: new Date(now.getTime() - 10 * DAY_MS),
        },
      ],
    });
    const metrics = await computeWeeklyMetrics(testDb, now);
    expect(metrics.lessonsCompleted.current).toBe(2);
    expect(metrics.lessonsCompleted.previous).toBe(1);
    expect(metrics.lessonsCompleted.delta).toBe(1);
    expect(metrics.activeStudents.current).toBe(1);
  });
});
