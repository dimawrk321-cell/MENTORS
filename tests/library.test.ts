import { describe, it, expect, beforeEach } from "vitest";
import { testDb, resetDb, createTestUser } from "./helpers/db";
import {
  getRecordingForView,
  listRecordingsCatalog,
  logRecordingOpen,
  setLibraryEnabled,
  setRecordingStatus,
  upsertRecording,
  type RecordingData,
} from "@/lib/services/library";
import { isLinkStale } from "@/lib/constants";

// Stage 7 library service (spec 7.9): checklist publication gate, per-open view
// logging, per-student toggle.

const COMPLETE = { faces: true, voice: true, names: true, consent: true };
const INCOMPLETE = { faces: true, voice: true, names: false, consent: true };

function recordingData(overrides: Partial<RecordingData> = {}): RecordingData {
  return {
    title: "Внутреннее название",
    stage: "livecoding",
    direction: "nlp",
    grade: "middle",
    outcome: "offer",
    companyType: "product",
    durationMinutes: 60,
    url: "https://disk.yandex.ru/i/abc",
    embedUrl: null,
    checklist: COMPLETE,
    status: "draft",
    ...overrides,
  };
}

async function makeAdmin(email = "admin@library.test") {
  return createTestUser({ email, role: "admin" });
}

describe("library — checklist publication gate (spec 7.9)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("refuses to create a published recording with an incomplete checklist", async () => {
    const admin = await makeAdmin();
    const res = await upsertRecording(testDb, {
      actorId: admin.id,
      data: recordingData({ checklist: INCOMPLETE, status: "published" }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("checklist_incomplete");
    expect(await testDb.recording.count()).toBe(0);
  });

  it("blocks publishing a draft until all four items are ticked", async () => {
    const admin = await makeAdmin();
    const created = await upsertRecording(testDb, {
      actorId: admin.id,
      data: recordingData({ checklist: INCOMPLETE, status: "draft" }),
    });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.id : "";

    // 3/4 → publish refused, stays draft, absent from the catalog.
    const refused = await setRecordingStatus(testDb, {
      actorId: admin.id,
      id,
      status: "published",
    });
    expect(refused.ok).toBe(false);
    expect((await listRecordingsCatalog(testDb, {})).length).toBe(0);

    // 4/4 via upsert → publish allowed, now visible.
    const published = await upsertRecording(testDb, {
      actorId: admin.id,
      id,
      data: recordingData({ checklist: COMPLETE, status: "published" }),
    });
    expect(published.ok).toBe(true);
    const catalog = await listRecordingsCatalog(testDb, {});
    expect(catalog.length).toBe(1);
  });

  it("keeps drafts out of the catalog and the view surface", async () => {
    const admin = await makeAdmin();
    const created = await upsertRecording(testDb, {
      actorId: admin.id,
      data: recordingData({ status: "draft" }),
    });
    const id = created.ok ? created.id : "";
    expect((await listRecordingsCatalog(testDb, {})).length).toBe(0);
    expect(await getRecordingForView(testDb, id)).toBeNull();
  });

  it("filters the catalog by stage/direction (spec 7.9)", async () => {
    const admin = await makeAdmin();
    await upsertRecording(testDb, {
      actorId: admin.id,
      data: recordingData({ stage: "livecoding", direction: "nlp", status: "published" }),
    });
    await upsertRecording(testDb, {
      actorId: admin.id,
      data: recordingData({ stage: "theory", direction: "ds", status: "published" }),
    });
    expect((await listRecordingsCatalog(testDb, { stage: "livecoding" })).length).toBe(1);
    expect((await listRecordingsCatalog(testDb, { direction: "ds" })).length).toBe(1);
    expect((await listRecordingsCatalog(testDb, { stage: "screening" })).length).toBe(0);
  });
});

describe("library — link staleness (spec 7.9)", () => {
  const now = new Date("2026-07-16T12:00:00.000Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  it("flags links strictly older than 30 days — header count and row highlight share one rule", () => {
    expect(isLinkStale(daysAgo(29), now)).toBe(false);
    expect(isLinkStale(daysAgo(30), now)).toBe(false); // exactly 30 days is not «старше 30»
    // The (30, 31) window: previously the header counted it but the floored row did not.
    expect(isLinkStale(daysAgo(30.5), now)).toBe(true);
    expect(isLinkStale(daysAgo(31), now)).toBe(true);
  });
});

describe("library — recording_views on every open (spec 7.9)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("writes a view row + recording.opened on each open", async () => {
    const admin = await makeAdmin();
    const student = await createTestUser({ email: "s@library.test", role: "student" });
    const created = await upsertRecording(testDb, {
      actorId: admin.id,
      data: recordingData({ status: "published" }),
    });
    const id = created.ok ? created.id : "";

    await logRecordingOpen(testDb, { userId: student.id, recordingId: id });
    await logRecordingOpen(testDb, { userId: student.id, recordingId: id });

    expect(await testDb.recordingView.count({ where: { recordingId: id } })).toBe(2);
    expect(await testDb.analyticsEvent.count({ where: { type: "recording.opened" } })).toBe(2);
  });

  it("refuses to log an open for a draft recording", async () => {
    const admin = await makeAdmin();
    const student = await createTestUser({ email: "s2@library.test", role: "student" });
    const created = await upsertRecording(testDb, {
      actorId: admin.id,
      data: recordingData({ status: "draft" }),
    });
    const id = created.ok ? created.id : "";
    const res = await logRecordingOpen(testDb, { userId: student.id, recordingId: id });
    expect(res.ok).toBe(false);
    expect(await testDb.recordingView.count()).toBe(0);
  });
});

describe("library — per-student toggle gates the section (spec 7.9)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("flips library_enabled (the flag pages/routes/nav key off) and audits it", async () => {
    const admin = await makeAdmin();
    const student = await createTestUser({ email: "s3@library.test", role: "student" });
    // Default is on (spec 6): the section is visible.
    expect(student.libraryEnabled).toBe(true);

    const off = await setLibraryEnabled(testDb, {
      actorId: admin.id,
      userId: student.id,
      enabled: false,
    });
    expect(off.ok).toBe(true);
    const afterOff = await testDb.user.findUnique({ where: { id: student.id } });
    expect(afterOff?.libraryEnabled).toBe(false);

    const on = await setLibraryEnabled(testDb, {
      actorId: admin.id,
      userId: student.id,
      enabled: true,
    });
    expect(on.ok).toBe(true);
    const afterOn = await testDb.user.findUnique({ where: { id: student.id } });
    expect(afterOn?.libraryEnabled).toBe(true);

    expect(await testDb.auditLog.count({ where: { action: "user.library_toggled" } })).toBe(2);
  });

  it("only toggles students", async () => {
    const admin = await makeAdmin();
    const mentor = await createTestUser({ email: "m@library.test", role: "mentor" });
    const res = await setLibraryEnabled(testDb, {
      actorId: admin.id,
      userId: mentor.id,
      enabled: false,
    });
    expect(res.ok).toBe(false);
  });
});
