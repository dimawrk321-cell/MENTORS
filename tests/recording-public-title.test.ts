import { beforeEach, describe, expect, it } from "vitest";
import {
  getRecordingForView,
  listRecordingsCatalog,
  upsertRecording,
  type RecordingData,
} from "@/lib/services/library";
import { search } from "@/lib/services/search";
import { recordingCardTitle, recordingStudentTitle } from "@/lib/constants";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Заход C.6, блок 2: у записи два заголовка — внутренний и ученический.
//
// Главная граница набора: внутреннее название НИКОГДА не доезжает до ученика —
// ни в каталоге, ни на странице записи, ни в поиске. Пустое ученическое название
// — штатное состояние: показывается анонимный ярлык «{Этап} · {Направление} ·
// {грейд}», а не подстановка внутреннего.

const INTERNAL = "Иванов, Тинькофф, лайфкодинг";
const COMPLETE = { faces: true, voice: true, names: true, consent: true };

function recordingData(overrides: Partial<RecordingData> = {}): RecordingData {
  return {
    title: INTERNAL,
    publicTitle: null,
    stage: "livecoding",
    direction: "nlp",
    grade: "middle",
    outcome: "offer",
    companyType: "product",
    durationMinutes: 60,
    url: "https://disk.yandex.ru/i/abc",
    checklist: COMPLETE,
    status: "published",
    ...overrides,
  };
}

async function makeRecording(overrides: Partial<RecordingData> = {}) {
  const admin = await createTestUser({
    email: `admin-${Math.random().toString(36).slice(2)}@rec.test`,
    role: "admin",
  });
  const res = await upsertRecording(testDb, {
    actorId: admin.id,
    data: recordingData(overrides),
  });
  if (!res.ok) throw new Error("fixture: upsertRecording failed");
  return { id: res.id, actorId: admin.id };
}

beforeEach(async () => {
  await resetDb();
});

describe("recordingStudentTitle — что видит ученик (заход C.6, 2.2)", () => {
  const base = { stage: "livecoding", direction: "nlp", grade: "middle" };

  it("есть своё название — показывается оно", () => {
    expect(recordingStudentTitle({ ...base, publicTitle: "Словарь и бинарный поиск" })).toBe(
      "Словарь и бинарный поиск",
    );
  });

  it("пусто, null и пробелы — анонимный ярлык, а НЕ внутреннее название", () => {
    const label = recordingCardTitle(base);
    expect(recordingStudentTitle({ ...base, publicTitle: null })).toBe(label);
    expect(recordingStudentTitle({ ...base, publicTitle: "" })).toBe(label);
    expect(recordingStudentTitle({ ...base, publicTitle: "   " })).toBe(label);
    expect(label).toBe("лайфкодинг · NLP · middle");
  });
});

describe("ученические выборки не несут внутреннего названия", () => {
  it("каталог отдаёт ученическое название и не отдаёт внутреннее", async () => {
    await makeRecording({ publicTitle: "Лайфкодинг: словарь и бинарный поиск" });
    const [row] = await listRecordingsCatalog(testDb, {});
    expect(row).toBeDefined();
    expect(Object.keys(row!)).not.toContain("title");
    expect(recordingStudentTitle(row!)).toBe("Лайфкодинг: словарь и бинарный поиск");
  });

  it("страница записи: пустое ученическое название → анонимный ярлык", async () => {
    const { id } = await makeRecording();
    const view = await getRecordingForView(testDb, id);
    expect(view).not.toBeNull();
    expect(Object.keys(view!)).not.toContain("title");
    expect(view!.publicTitle).toBeNull();
    expect(recordingStudentTitle(view!)).toBe("лайфкодинг · NLP · middle");
  });

  it("upsert хранит название и пишет его в аудит", async () => {
    const { id, actorId } = await makeRecording({ publicTitle: "Разбор оффера" });
    const row = await testDb.recording.findUniqueOrThrow({ where: { id } });
    expect(row.title).toBe(INTERNAL);
    expect(row.publicTitle).toBe("Разбор оффера");

    const created = await testDb.auditLog.findFirstOrThrow({
      where: { action: "recording.created", entityId: id },
    });
    expect(created.actorId).toBe(actorId);
    expect(created.after).toMatchObject({ publicTitle: "Разбор оффера" });
  });
});

describe("поиск ученика видит только ученическое название (заход C.6)", () => {
  let viewerId = "";
  beforeEach(async () => {
    const user = await createTestUser({ email: "viewer@rec.test" });
    viewerId = user.id;
  });

  it("находит по ученическому названию", async () => {
    await makeRecording({ publicTitle: "Лайфкодинг про трансформеры" });
    const res = await search(testDb, {
      q: "трансформеры",
      userId: viewerId,
      libraryEnabled: true,
    });
    const group = res.groups.find((g) => g.type === "recordings");
    expect(group?.items).toHaveLength(1);
    expect(group?.items[0]?.title).toBe("Лайфкодинг про трансформеры");
  });

  it("НЕ находит по внутреннему названию — и не показывает его в сниппете", async () => {
    await makeRecording({ title: "Иванов, Тинькофф — оффер", publicTitle: "Разбор лайфкодинга" });
    const byCompany = await search(testDb, {
      q: "Тинькофф",
      userId: viewerId,
      libraryEnabled: true,
    });
    expect(byCompany.groups.some((g) => g.type === "recordings")).toBe(false);

    const found = await search(testDb, {
      q: "лайфкодинга",
      userId: viewerId,
      libraryEnabled: true,
    });
    const group = found.groups.find((g) => g.type === "recordings");
    expect(group?.items).toHaveLength(1);
    expect(JSON.stringify(group?.items[0])).not.toContain("Тинькофф");
  });

  it("запись без ученического названия текстовым поиском не находится (цена решения)", async () => {
    await makeRecording({ title: "Уникальнейшее внутреннее слово криптовалюта" });
    const res = await search(testDb, {
      q: "криптовалюта",
      userId: viewerId,
      libraryEnabled: true,
    });
    expect(res.groups.some((g) => g.type === "recordings")).toBe(false);
  });
});
