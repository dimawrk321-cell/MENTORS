import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionCardDeck, type DeckItem } from "@/components/features/session-card-deck";

// Кнопка выхода зовёт useRouter — вне Next-рантайма его надо подставить.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
}));

// ЧТО ЭТОТ ФАЙЛ ОХРАНЯЕТ — И ЧТО НЕТ (заход «Хвосты по тостам и высоте»).
//
// jsdom в проекте нет: дека рендерится в СТАТИЧЕСКУЮ разметку
// (`react-dom/server`). Значит здесь нет ни раскладки, ни размеров, ни
// вычисленных стилей — тест проверяет КОНТРАКТ КЛАССОВ (какие классы стоят на
// гранях, теле и панели оценок), а не пиксели. Ссылаться на него как на защиту
// геометрии нельзя: он не отличит `max-h-[…]`, который работает, от такого же,
// который перебит `min-height`. Геометрия проверяется замером в браузере на
// 390×844 / 390×640 / 844×390 и описана в отчёте захода.
//
// Регресс находок владельца по деке карточек:
//   • «Доступ к вопросам»: скрытая грань не должна раздувать флип — иначе
//     короткий вопрос с длинным эталоном уносит кнопку за нижний край экрана;
//   • «Мобильный тренажёр и тосты»: тело грани скроллится внутри себя, а панель
//     оценок и компактная строка вопроса остаются на экране;
//   • «Хвосты по тостам и высоте»: у грани есть ПОЛ высоты (иначе на альбомной
//     ориентации телефона вычет из 100dvh уходит в 62px), а панель оценок
//     помечена нижним доком — над ней встают тосты.

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

  it("у грани есть пол высоты, считаемый от того же максимума", () => {
    // На альбомной ориентации телефона (844×390) вычет из 100dvh даёт 62px:
    // прежний фиксированный min-h-[240px] перебивал max-height и выносил
    // карточку за экран. Пол берётся как min(240px, максимум) — значит min-h
    // обязан ссылаться на --deck-face-max.
    const html = render(false);
    expect(html).toContain("min-h-[min(15rem,var(--deck-face-max))]");
    expect(html).toContain("md:min-h-[min(17.5rem,var(--deck-face-max))]");
    // Сам максимум и его пол объявлены в globals.css на .session-deck.
    expect(html).toContain("session-deck");
  });

  it("панель оценок липкая, помечена нижним доком и содержит все три оценки", () => {
    const html = render(true);
    expect(html).toContain("sticky bottom-0");
    // Тост встаёт над ФАКТИЧЕСКИМ нижним контролом: в focused-зоне BottomNav
    // нет, есть эта панель (lib/utils/bottom-dock.ts).
    expect(html).toContain("data-bottom-dock");
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

// --- Шапка сессии (заход B.4) ------------------------------------------------
// Те же оговорки: это контракт разметки, а не геометрия. Замеры 390×844 и
// 1280×800 в обеих темах — в отчёте захода.

function renderHeader(note?: string): string {
  return renderToStaticMarkup(
    <SessionCardDeck
      item={{
        ...item,
        category: { title: "Вопросы о профессиональных интересах и ожиданиях", colorIndex: 3 },
      }}
      index={5}
      total={15}
      flipped={false}
      pending={false}
      active
      exitHref="/trainer"
      exitLabel="Закончить"
      exitConfirm="Прервать?"
      note={note}
      onFlip={() => {}}
      onGrade={() => {}}
    />,
  );
}

describe("шапка сессии", () => {
  it("счётчик — главное число, пояснение режима приглушено и стоит отдельной строкой", () => {
    const html = renderHeader("тренировка · без XP и серии");
    // Счётчик: 16px/600 у text-1; знаменатель приглушён внутри той же строки.
    expect(html).toContain(
      'class="text-text-1 text-[16px] leading-tight font-semibold tabular-nums"',
    );
    expect(html).toContain('<span class="text-text-3 font-normal"> / 15</span>');
    // Пояснение — 12px text-3, отдельным абзацем ПОСЛЕ счётчика.
    expect(html).toContain('class="text-text-3 mt-0.5 text-[12px]">тренировка · без XP и серии');
    expect(html.indexOf("tabular-nums")).toBeLessThan(html.indexOf("тренировка · без XP и серии"));
  });

  it("без пояснения режима (дневная очередь) второй строки нет", () => {
    expect(renderHeader()).not.toContain("mt-0.5 text-[12px]");
  });

  it("полоса прогресса живёт в той же липкой шапке, что и счётчик", () => {
    const html = renderHeader();
    const header = html.slice(0, html.indexOf("session-deck") + 4000);
    const barAt = header.indexOf('role="progressbar"');
    const headerAt = header.indexOf("sticky top-0");
    const chipAt = header.indexOf("rounded-pill border-border");
    expect(headerAt).toBeGreaterThan(-1);
    // Полоса — внутри шапки (после её открывающего тега и ДО метки категории),
    // а не отдельной строкой под ней: gap-2 вместо прежнего gap-4.
    expect(barAt).toBeGreaterThan(headerAt);
    expect(barAt).toBeLessThan(chipAt);
    expect(header).toContain("sticky top-0 z-10 flex flex-col gap-2");
  });

  it("«Закончить» без стрелки: направление называет слово, а не глиф", () => {
    const html = renderHeader();
    const at = html.indexOf("Закончить");
    // Перед подписью выхода нет svg-стрелки (её рисует BackButton по умолчанию).
    const before = html.slice(html.lastIndexOf("<button", at), at);
    expect(before).not.toContain("<svg");
  });

  it("метка категории показывается целиком, без обрезки", () => {
    const html = renderHeader();
    const at = html.indexOf("Вопросы о профессиональных интересах и ожиданиях");
    expect(at).toBeGreaterThan(-1);
    const chip = html.slice(html.lastIndexOf("<span", html.lastIndexOf("<span", at) - 1), at);
    expect(chip).not.toContain("truncate");
    expect(chip).not.toContain("max-w-[13rem]");
  });
});
