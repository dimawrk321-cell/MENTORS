import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionCardDeck, type DeckItem } from "@/components/features/session-card-deck";

// Кнопка выхода зовёт useRouter — вне Next-рантайма его надо подставить.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
}));

// Регресс двух находок владельца по деке карточек:
//   • «Доступ к вопросам»: скрытая грань не должна раздувать флип — иначе
//     короткий вопрос с длинным эталоном уносит кнопку за нижний край экрана;
//   • «Мобильный тренажёр и тосты»: тело грани скроллится внутри себя, а панель
//     оценок и компактная строка вопроса остаются на экране.
//
// jsdom в проекте нет, поэтому дека рендерится в статическую разметку
// (react-dom/server) — эффекты не нужны, проверяется именно раскладка классов.

const item: DeckItem = {
  id: "card-1",
  category: { title: "Python", colorIndex: 1 },
  lesson: null,
  questionText: "Что такое asyncio и когда он нужен?",
  questionNode: <p>Что такое asyncio и когда он нужен?</p>,
  answerNode: <p>{"Длинный эталон. ".repeat(200)}</p>,
};

function render(flipped: boolean): string {
  return renderToStaticMarkup(
    <SessionCardDeck
      item={item}
      index={0}
      total={15}
      flipped={flipped}
      pending={false}
      active
      exitHref="/trainer"
      exitLabel="Закончить"
      exitConfirm="Прервать?"
      onFlip={() => {}}
      onGrade={() => {}}
    />,
  );
}

/** Класс-список грани по её содержимому: вопрос — лицевая, эталон — обратная. */
function faceClasses(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const opening = html.lastIndexOf('<div class="col-start-1', at);
  expect(opening).toBeGreaterThan(-1);
  return html.slice(opening, html.indexOf(">", opening));
}

describe("высота граней флип-карточки", () => {
  it("скрытая грань схлопнута и не участвует в высоте ячейки", () => {
    const front = render(false);
    expect(faceClasses(front, "Эталонный ответ")).toContain("max-h-0");
    expect(faceClasses(front, ">Вопрос<")).not.toContain("max-h-0");

    const back = render(true);
    expect(faceClasses(back, "Эталонный ответ")).not.toContain("max-h-0");
    expect(faceClasses(back, ">Вопрос<")).toContain("max-h-0");
  });

  it("длинный эталон не растягивает карточку: высота ограничена вьюпортом", () => {
    const html = render(true);
    expect(html).toContain("--deck-face-max");
    // Тело грани — собственный скроллер, а не рост карточки вниз.
    expect(html).toContain("overflow-y-auto overscroll-contain");
  });

  it("панель оценок липкая и содержит все три оценки", () => {
    const html = render(true);
    expect(html).toContain("sticky bottom-0");
    for (const label of ["Не знаю", "Сомневаюсь", "Знаю"]) {
      expect(html).toContain(label);
    }
  });

  it("на нефлипнутой карточке видна кнопка «Показать ответ»", () => {
    expect(render(false)).toContain("Показать ответ");
  });
});

describe("вопрос при раскрытом ответе", () => {
  it("компактная строка вопроса стоит над эталоном", () => {
    const html = render(true);
    expect(html).toContain(item.questionText);
    expect(html.indexOf(item.questionText)).toBeLessThan(html.indexOf("Эталонный ответ"));
    expect(html).toContain('aria-expanded="false"');
  });
});
