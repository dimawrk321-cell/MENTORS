import { beforeEach, describe, expect, it } from "vitest";
import type { ContentStatus } from "@prisma/client";
import { deleteRecording } from "@/lib/services/library";
import { inviteMentor } from "@/lib/services/access";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Мелкие долги админки (spec 8.5/19): удаление записи (draft + 0 просмотров),
// инвайт ментора (роль, is_interviewer).

beforeEach(async () => {
  await resetDb();
});

async function makeRecording(status: ContentStatus = "draft") {
  return testDb.recording.create({
    data: {
      title: "Запись",
      stage: "theory",
      direction: "nlp",
      grade: "middle",
      outcome: "offer",
      companyType: "bigtech",
      durationMinutes: 60,
      url: "https://disk.yandex/x",
      checklist: { faces: true, voice: true, names: true, consent: true },
      status,
    },
  });
}

describe("Удаление записи библиотеки", () => {
  it("удаляет только черновик без просмотров", async () => {
    const admin = await createTestUser({ email: "admin@t.local", role: "admin" });
    const draft = await makeRecording("draft");

    const res = await deleteRecording(testDb, { actorId: admin.id, id: draft.id });
    expect(res).toEqual({ ok: true });
    expect(await testDb.recording.findUnique({ where: { id: draft.id } })).toBeNull();
  });

  it("отказывает опубликованной записи", async () => {
    const admin = await createTestUser({ email: "admin@t.local", role: "admin" });
    const published = await makeRecording("published");
    const res = await deleteRecording(testDb, { actorId: admin.id, id: published.id });
    expect(res).toEqual({ ok: false, code: "not_draft" });
    expect(await testDb.recording.findUnique({ where: { id: published.id } })).not.toBeNull();
  });

  it("отказывает черновику с просмотрами", async () => {
    const admin = await createTestUser({ email: "admin@t.local", role: "admin" });
    const student = await createTestUser({ email: "s@t.local" });
    const draft = await makeRecording("draft");
    await testDb.recordingView.create({ data: { recordingId: draft.id, userId: student.id } });

    const res = await deleteRecording(testDb, { actorId: admin.id, id: draft.id });
    expect(res).toEqual({ ok: false, code: "has_views" });
    expect(await testDb.recording.findUnique({ where: { id: draft.id } })).not.toBeNull();
  });
});

describe("Инвайт ментора", () => {
  it("создаёт ментора с is_interviewer, без срока доступа", async () => {
    const owner = await createTestUser({ email: "owner@t.local", role: "owner" });
    const res = await inviteMentor(testDb, {
      actorId: owner.id,
      email: "new-mentor@t.local",
      name: "Новый Ментор",
      isInterviewer: true,
    });
    expect(res.ok).toBe(true);
    const user = await testDb.user.findUnique({ where: { email: "new-mentor@t.local" } });
    expect(user).toMatchObject({
      role: "mentor",
      isInterviewer: true,
      status: "invited",
      accessUntil: null,
    });
    const invite = await testDb.invite.findFirst({ where: { email: "new-mentor@t.local" } });
    expect(invite).not.toBeNull();
    // Аудит мутации.
    const audit = await testDb.auditLog.findFirst({ where: { action: "mentor.invited" } });
    expect(audit).not.toBeNull();
  });

  it("is_interviewer=false → обычный ментор", async () => {
    const owner = await createTestUser({ email: "owner@t.local", role: "owner" });
    await inviteMentor(testDb, {
      actorId: owner.id,
      email: "m2@t.local",
      name: "Ментор",
      isInterviewer: false,
    });
    const user = await testDb.user.findUnique({ where: { email: "m2@t.local" } });
    expect(user?.role).toBe("mentor");
    expect(user?.isInterviewer).toBe(false);
  });

  it("существующий email — отказ", async () => {
    const owner = await createTestUser({ email: "owner@t.local", role: "owner" });
    await createTestUser({ email: "taken@t.local", role: "student" });
    const res = await inviteMentor(testDb, {
      actorId: owner.id,
      email: "taken@t.local",
      name: "X",
      isInterviewer: false,
    });
    expect(res.ok).toBe(false);
  });
});
