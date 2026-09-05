import { beforeEach, describe, expect, it } from "vitest";
import {
  createStudySession,
  getStudyMentorFlags,
  StudySessionError,
  updateStudySession,
} from "@/lib/services/study-sessions";
import { newStudyFields } from "@/lib/utils/study-session-summary";
import { createTestUser, resetDb, testDb } from "./helpers/db";

beforeEach(resetDb);
describe("study session lifecycle", () => {
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
