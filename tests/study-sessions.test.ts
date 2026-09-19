import { beforeEach, describe, expect, it } from "vitest";
import {
  createStudySession,
  getStudySessionDashboard,
  getStudyMentorFlags,
  StudySessionError,
  updateStudySession,
} from "@/lib/services/study-sessions";
import { newStudyFields } from "@/lib/utils/study-session-summary";
import { createTestUser, resetDb, testDb } from "./helpers/db";

beforeEach(resetDb);
describe("study session lifecycle", () => {
  it("persists lesson checkpoints without completion or rewards and resumes only own matching lesson", async () => {
    const user = await createTestUser({ email: "checkpoint@example.com" });
    const other = await createTestUser({ email: "other-checkpoint@example.com" });
    const course = await testDb.course.create({
      data: { slug: "checkpoint", title: "Курс", order: 0, status: "published", gating: "free" },
    });
    const mod = await testDb.module.create({
      data: { courseId: course.id, title: "Модуль", order: 0, status: "published" },
    });
    const lesson = await testDb.lesson.create({
      data: {
        moduleId: mod.id,
        title: "Урок",
        slug: "checkpoint",
        order: 0,
        status: "published",
        contentMd: "Текст",
      },
    });
    let card = await createStudySession(testDb, user.id, lesson.id);
    const command = async (
      operation: "start" | "save" | "abandon",
      percent: number | null,
      point: string,
    ) => {
      card = await updateStudySession(testDb, user.id, {
        id: card.id,
        version: card.version,
        operation,
        fields: {
          ...card.fields,
          goal: "Изучить урок",
          lessonPercent: percent,
          stoppingPoint: point,
        },
      });
    };
    await command("start", null, "");
    await command("save", 100, "Видео 24:30");
    expect(
      (await testDb.studySession.findUniqueOrThrow({ where: { id: card.id } })).fields,
    ).toMatchObject({ lessonPercent: 100, stoppingPoint: "Видео 24:30" });
    expect(
      await testDb.lessonProgress.count({ where: { userId: user.id, status: "completed" } }),
    ).toBe(0);
    expect(await testDb.xpEvent.count({ where: { userId: user.id } })).toBe(0);
    expect(await testDb.srsCard.count({ where: { userId: user.id } })).toBe(0);
    await expect(
      updateStudySession(testDb, other.id, {
        id: card.id,
        version: card.version,
        operation: "save",
        fields: card.fields,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await command("abandon", 40, "Шаг 2");
    const previousId = card.id;
    const next = await createStudySession(testDb, user.id, lesson.id);
    expect(next.fields).toMatchObject({
      lessonPercent: null,
      stoppingPoint: "",
      previousCheckpoint: { sessionId: previousId, percent: 40, stoppingPoint: "Шаг 2" },
    });
    const otherCard = await createStudySession(testDb, other.id, lesson.id);
    expect(otherCard.fields.previousCheckpoint).toBeNull();
    const forged = await updateStudySession(testDb, other.id, {
      id: otherCard.id,
      version: otherCard.version,
      operation: "save",
      fields: { ...otherCard.fields, previousCheckpoint: next.fields.previousCheckpoint },
    });
    expect(forged.fields.previousCheckpoint).toBeNull();
    const noteOnly = await updateStudySession(testDb, user.id, {
      id: next.id,
      version: next.version,
      operation: "abandon",
      fields: { ...next.fields, stoppingPoint: "Только заметка, видео 38:10" },
    });
    const resumed = await createStudySession(testDb, user.id, lesson.id);
    expect(resumed.fields.previousCheckpoint).toMatchObject({
      sessionId: noteOnly.id,
      percent: null,
      stoppingPoint: "Только заметка, видео 38:10",
    });
    await updateStudySession(testDb, user.id, {
      id: resumed.id,
      version: resumed.version,
      operation: "abandon",
      fields: resumed.fields,
    });
    const secondLesson = await testDb.lesson.create({
      data: {
        moduleId: mod.id,
        title: "Другой урок",
        slug: "second",
        order: 1,
        status: "published",
        contentMd: "Другой текст",
      },
    });
    expect(
      (await createStudySession(testDb, user.id, secondLesson.id)).fields.previousCheckpoint,
    ).toBeNull();
  });

  it("rejects lesson percentage in an unlinked session but saves a stopping note", async () => {
    const user = await createTestUser({ email: "unlinked@example.com" });
    const card = await createStudySession(testDb, user.id);
    await expect(
      updateStudySession(testDb, user.id, {
        id: card.id,
        version: card.version,
        operation: "save",
        fields: { ...card.fields, lessonPercent: 50 },
      }),
    ).rejects.toMatchObject({ code: "validation" });
    const saved = await updateStudySession(testDb, user.id, {
      id: card.id,
      version: card.version,
      operation: "save",
      fields: { ...card.fields, stoppingPoint: "Задача 3" },
    });
    expect(saved.fields.stoppingPoint).toBe("Задача 3");
  });
  it("restores one draft, transitions, records elapsed facts and completion event", async () => {
    const user = await createTestUser({ email: "study@example.com", timezone: "Europe/Moscow" });
    const created = await createStudySession(
      testDb,
      user.id,
      null,
      new Date("2026-09-05T10:00:00Z"),
    );
    expect(
      (await createStudySession(testDb, user.id, null, new Date("2026-09-05T10:01:00Z"))).id,
    ).toBe(created.id);
    const fields = {
      ...created.fields,
      topic: "Attention",
      goal: "объяснить механизм",
      startedOnTime: true,
      completedBlocks: 1,
      distractions: 0,
      explain: "yes" as const,
      thoughts: ["Q", "K", "V"] as [string, string, string],
      nextAction: "повторить завтра",
    };
    const running = await updateStudySession(
      testDb,
      user.id,
      { id: created.id, version: created.version, operation: "start", fields },
      new Date("2026-09-05T10:05:00Z"),
    );
    const reflection = await updateStudySession(
      testDb,
      user.id,
      { id: created.id, version: running.version, operation: "stop", fields },
      new Date("2026-09-05T10:35:00Z"),
    );
    const completed = await updateStudySession(
      testDb,
      user.id,
      { id: created.id, version: reflection.version, operation: "complete", fields },
      new Date("2026-09-05T10:37:00Z"),
    );
    expect(completed.status).toBe("completed");
    expect(completed.startedAt).toBe("2026-09-05T10:05:00.000Z");
    expect(completed.endedAt).toBe("2026-09-05T10:35:00.000Z");
    expect(
      await testDb.analyticsEvent.count({
        where: { userId: user.id, type: "study_session.completed" },
      }),
    ).toBe(1);
  });
  it("rejects stale-tab writes without overwriting", async () => {
    const user = await createTestUser({ email: "tabs@example.com" });
    const created = await createStudySession(testDb, user.id);
    await updateStudySession(testDb, user.id, {
      id: created.id,
      version: created.version,
      operation: "save",
      fields: { ...created.fields, topic: "Первая вкладка" },
    });
    await expect(
      updateStudySession(testDb, user.id, {
        id: created.id,
        version: created.version,
        operation: "save",
        fields: { ...created.fields, topic: "Вторая вкладка" },
      }),
    ).rejects.toMatchObject({ code: "conflict" } satisfies Partial<StudySessionError>);
    expect(
      (await testDb.studySession.findUniqueOrThrow({ where: { id: created.id } })).fields,
    ).toMatchObject({ topic: "Первая вкладка" });
  });

  it("returns a bounded dashboard overview with the active session and current week", async () => {
    const user = await createTestUser({ email: "dashboard-study@example.com" });
    const fields = {
      ...newStudyFields("Attention", "2026-09-01T19:00"),
      startedOnTime: true,
      completedBlocks: 1,
      distractions: 0,
      explain: "yes" as const,
      thoughts: ["Q", "K", "V"] as [string, string, string],
    };
    for (let day = 1; day <= 4; day += 1) {
      const endedAt = new Date(`2026-09-0${day}T17:30:00Z`);
      await testDb.studySession.create({
        data: {
          userId: user.id,
          timezone: user.timezone,
          status: "completed",
          fields,
          plannedAt: new Date(`2026-09-0${day}T17:00:00Z`),
          startedAt: new Date(endedAt.getTime() - 30 * 60_000),
          endedAt,
          completedAt: endedAt,
          createdAt: endedAt,
        },
      });
    }
    const active = await testDb.studySession.create({
      data: {
        userId: user.id,
        activeUserId: user.id,
        timezone: user.timezone,
        status: "draft",
        fields: newStudyFields("Новая тема", "2026-09-05T19:00"),
        plannedAt: new Date("2026-09-05T16:00:00Z"),
        createdAt: new Date("2026-09-05T15:00:00Z"),
      },
    });
    const dashboard = await getStudySessionDashboard(
      testDb,
      user.id,
      new Date("2026-09-05T18:00:00Z"),
      user.timezone,
    );
    expect(dashboard.active?.id).toBe(active.id);
    expect(dashboard.summary).toMatchObject({ count: 4, totalMinutes: 120, unfinished: 1 });
    expect(dashboard.recent).toHaveLength(3);
    expect(dashboard.recent.map((card) => card.endedAt)).toEqual([
      "2026-09-04T17:30:00.000Z",
      "2026-09-03T17:30:00.000Z",
      "2026-09-02T17:30:00.000Z",
    ]);
  });

  it("returns mentor risks with the exact linked sessions", async () => {
    const user = await createTestUser({ email: "risk@example.com" });
    const fields = {
      ...newStudyFields("Градиенты", "2026-09-03T12:00"),
      startedOnTime: false,
      completedBlocks: 1,
      distractions: 4,
      explain: "no" as const,
      thoughts: ["a", "b", "c"] as [string, string, string],
      gaps: "Градиентный спуск",
      nextAction: "Повторить",
    };
    const ids: string[] = [];
    for (let day = 1; day <= 3; day += 1) {
      const endedAt = new Date(`2026-09-0${day}T12:30:00Z`);
      const row = await testDb.studySession.create({
        data: {
          userId: user.id,
          timezone: user.timezone,
          status: "completed",
          fields,
          plannedAt: new Date(`2026-09-0${day}T09:00:00Z`),
          startedAt: new Date(endedAt.getTime() - 30 * 60_000),
          endedAt,
          completedAt: endedAt,
        },
      });
      ids.push(row.id);
    }
    const flags = await getStudyMentorFlags(testDb, new Date("2026-09-04T12:00:00Z"));
    expect(flags.find((flag) => flag.type === "explain")?.sessionIds.sort()).toEqual(ids.sort());
    expect(flags.some((flag) => flag.type.startsWith("gap:"))).toBe(true);
  });
});
