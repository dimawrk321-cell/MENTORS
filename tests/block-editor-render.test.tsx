import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BlockEditor } from "@/components/features/block-editor";

// Заход B.1: редактор блоков должен ПОКАЗЫВАТЬ два новых блока — кнопку вставки
// в палитре и собственную карточку с полями.
//
// ЧТО ЭТОТ ФАЙЛ ОХРАНЯЕТ И ЧТО НЕТ: jsdom в проекте нет, редактор рендерится в
// статическую разметку (`react-dom/server`) — здесь нет ни кликов, ни раскладки.
// Проверяется наличие и подписи элементов, а не поведение диалога выбора вопроса
// (оно проверено в браузере и описано в отчёте захода).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
}));
// Серверные действия редактора в статическом рендере не вызываются.
vi.mock("@/lib/actions/questions-admin", () => ({
  lookupQuizQuestionAction: async () => ({ ok: true, data: null }),
  searchQuizQuestionsAction: async () => ({ ok: true, data: [] }),
}));

const DOC = [
  ':::spoiler{title="Почему так?"}',
  "Потому что.",
  ":::",
  "",
  ':::question{id="q1"}',
  ":::",
  "",
].join("\n");

function render(zone: "lesson" | "guide", value = DOC): string {
  return renderToStaticMarkup(<BlockEditor value={value} onChange={() => {}} zone={zone} />);
}

describe("палитра вставки", () => {
  it("в уроке есть кнопки «Скрытый ответ» и «Вопрос из банка»", () => {
    const html = render("lesson", "");
    expect(html).toContain("Скрытый ответ");
    expect(html).toContain("Вопрос из банка");
  });

  it("в гайде вопрос из банка не предлагается (отвечать его негде), спойлер — да", () => {
    const html = render("guide", "");
    expect(html).toContain("Скрытый ответ");
    expect(html).not.toContain("Вопрос из банка");
  });
});

describe("карточки новых блоков", () => {
  it("спойлер редактируется как заголовок + тело", () => {
    const html = render("lesson");
    expect(html).toContain("Заголовок скрытого ответа");
    expect(html).toContain("Почему так?");
    expect(html).toContain("Потому что.");
    // Ментор не видит синтаксис директивы.
    expect(html).not.toContain(":::spoiler");
  });

  it("вопрос показывает выбор, а не поле для cuid", () => {
    // Пустой блок зовёт выбрать вопрос; заполненный — заменить.
    expect(render("lesson", ':::question{id=""}\n:::\n')).toContain("Выбрать вопрос");
    const html = render("lesson");
    expect(html).toContain("Заменить вопрос");
    expect(html).not.toContain(":::question");
    // Первый кадр не обвиняет рабочий вопрос в том, что его нет в банке.
    expect(html).toContain("Загружаю вопрос…");
    expect(html).not.toContain("Вопрос не найден в банке");
  });
});
