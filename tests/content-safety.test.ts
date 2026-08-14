import { describe, expect, it } from "vitest";
import {
  hasUnsafeRecordingReference,
  PROTECTED_RECORDING_NOTICE,
  redactProtectedRecordingSnippet,
  sanitizeProtectedRecordingMarkdown,
} from "@/lib/utils/content-safety";

describe("protected interview recordings", () => {
  it("removes a raw recording URL and access secret from student markdown", () => {
    const source = [
      "## Реальный лайфкодинг",
      "Смотри на формат ответа.",
      "[https://disk.yandex.ru/i/example](https://disk.yandex.ru/i/example)",
      "Пароль: demo-123",
    ].join("\n");

    expect(hasUnsafeRecordingReference(source)).toBe(true);
    const safe = sanitizeProtectedRecordingMarkdown(source);
    expect(safe).not.toContain("disk.yandex.ru");
    expect(safe).not.toContain("demo-123");
    expect(safe).toContain(PROTECTED_RECORDING_NOTICE);
  });

  it("also protects a clearly identified interview recording without a password", () => {
    const source =
      "Запись собеседования: [https://disk.yandex.ru/i/example](https://disk.yandex.ru/i/example)";
    expect(hasUnsafeRecordingReference(source)).toBe(true);
    expect(sanitizeProtectedRecordingMarkdown(source)).not.toContain("disk.yandex.ru");
  });

  it("preserves ordinary Я.Диск lectures and required learning sources", () => {
    const lecture = [
      "## L1 Представление текста",
      "[Лекция](https://disk.yandex.ru/i/lecture)",
      "[Репозиторий курса](https://github.com/example/course)",
    ].join("\n");

    expect(hasUnsafeRecordingReference(lecture)).toBe(false);
    expect(sanitizeProtectedRecordingMarkdown(lecture)).toBe(lecture);
  });

  it("redacts legacy search snippets", () => {
    const safe = redactProtectedRecordingSnippet(
      "Пароль: demo-123 https://disk.yandex.ru/i/example",
    );
    expect(safe).toBe("Пароль: [скрыт] [запись доступна в Библиотеке]");
  });
});
