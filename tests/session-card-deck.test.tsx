import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SessionCardDeck,
  type DeckGrade,
  type DeckItem,
  type DeckOutcome,
} from "@/components/features/session-card-deck";

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
//     помечена нижним доком — над ней встают тосты;
//   • заход C.8: ритм по карточкам, мета-строка, инлайн-подтверждение — и то,
//     что новые пропсы не трогают ввод и оценку.

const item: DeckItem = {
  id: "card-1",
  category: { title: "Python", colorIndex: 1 },
  lesson: null,
  questionText: "Что такое asyncio и когда он нужен?",
  questionNode: <p>Что такое asyncio и когда он нужен?</p>,
  answerNode: <p>{"Длинный эталон. ".repeat(200)}</p>,
};

type DeckProps = Partial<React.ComponentProps<typeof SessionCardDeck>>;

function renderDeck(props: DeckProps = {}): string {
  return renderToStaticMarkup(
    <SessionCardDeck
      item={item}
      index={0}
      total={15}
      grades={[]}
      flipped={false}
      pending={false}
      active
      exitHref="/trainer"
      exitLabel="Закончить"
      exitConfirm="Прервать?"
      onFlip={() => {}}
      onGrade={() => {}}
      {...props}
    />,
  );
}

function render(flipped: boolean): string {
  return renderDeck({ flipped });
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
    // Контракт раскладки короткой карточки: дека занимает свободную высоту, а
    // панель уходит вниз через mt-auto вместо зависания посередине экрана.
    expect(html).toContain("max-w-3xl flex-1 flex-col");
    expect(html).toContain("bottom-0 z-10 mt-auto");
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

// --- Ритм по карточкам (заход C.8) ------------------------------------------

describe("ритм по карточкам", () => {
  it("сегментов столько же, сколько карточек в порции", () => {
    const html = renderDeck({ total: 15, index: 3, grades: ["good", "hard", "again"] });
    const bar = html.slice(html.indexOf('role="progressbar"'));
    const segments = bar.slice(0, bar.indexOf("</div>")).match(/rounded-pill block h-1\.5/g);
    expect(segments).toHaveLength(15);
  });

  it("цвет сегмента — фактическая оценка, текущий — градиент, будущие — heat-empty", () => {
    const html = renderDeck({ total: 4, index: 2, grades: ["good", "again"] });
    const bar = html.slice(html.indexOf('role="progressbar"'));
    const head = bar.slice(0, bar.indexOf("</div>"));
    expect(head).toContain("background:var(--success)");
    expect(head).toContain("background:var(--danger)");
    expect(head).toContain("background-image:var(--gradient-accent)");
    expect(head).toContain("background:var(--heat-empty)");
  });

  it("скринридеру достаётся подпись, а не цвет: progressbar с «Карточка N из M»", () => {
    const html = renderDeck({ total: 15, index: 4, grades: ["good", "good", "hard", "again"] });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="33"');
    expect(html).toContain('aria-label="Карточка 5 из 15"');
    // Сегменты сами по себе не читаются — они выведены из дерева доступности.
    const bar = html.slice(html.indexOf('role="progressbar"'));
    expect(bar.slice(0, bar.indexOf("</div>"))).toContain('aria-hidden="true"');
  });

  it("первая карточка уже считается текущим шагом, а не нулём", () => {
    const html = renderDeck({ total: 15, index: 0 });
    expect(html).toContain('aria-valuenow="7"');
  });

  it("выше порога рисуется прежняя сплошная полоса", () => {
    const html = renderDeck({ total: 25, index: 4, grades: ["good"] });
    expect(html).toContain("width:20%");
    expect(html).not.toContain("rounded-pill block h-1.5");
    // Подпись и проценты остаются теми же — меняется только рисунок.
    expect(html).toContain('aria-label="Карточка 5 из 25"');
  });
});

// --- Мета-строка карточки (заход C.8) ---------------------------------------

describe("мета-строка карточки", () => {
  it("«Новая карточка» — только при нулевой ступени", () => {
    expect(renderDeck({ step: 0 })).toContain("Новая карточка");
    expect(renderDeck({ step: 3 })).not.toContain("Новая карточка");
    // В свободной тренировке ступени нет вовсе — код работает без неё.
    expect(renderDeck({})).not.toContain("Новая карточка");
  });

  it("номер ступени не показывается никогда: он подсказывает оценку", () => {
    for (const step of [0, 1, 2, 3, 4, 5]) {
      const html = renderDeck({ step });
      expect(html).not.toContain("Ступень");
      expect(html).not.toContain("из 5");
    }
  });

  it("источник карточки стоит в мета-строке, а не строкой под счётчиком", () => {
    const html = renderDeck({
      sourceLabel: "Из урока «Функции и их особенности в Python»",
      note: "Порция 1 из 2 · дневная очередь",
    });
    const source = html.indexOf("Из урока «Функции");
    const chip = html.indexOf("Python<"); // метка категории
    const counter = html.indexOf("Порция 1 из 2");
    expect(source).toBeGreaterThan(-1);
    expect(source).toBeGreaterThan(chip);
    expect(counter).toBeLessThan(chip);
  });

  it("сроков и интервалов на экране нет ни в каком виде", () => {
    const html = renderDeck({
      step: 2,
      flipped: true,
      sourceLabel: "Добавлено вручную из каталога",
      outcome: { grade: "again", itemId: item.id, lessonId: "lesson-7" },
    });
    for (const forbidden of ["Следующее повторение", "через", "дней", "Ступень"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

// --- Инлайн-подтверждение после оценки (заход C.8) --------------------------

const outcome: DeckOutcome = { grade: "again", itemId: item.id, lessonId: "lesson-7" };

describe("инлайн-подтверждение после оценки", () => {
  it("место под полосу зарезервировано постоянной высотой ещё до первой оценки", () => {
    const html = renderDeck({ flipped: true, outcome: null });
    expect(html).toContain("h-[var(--deck-outcome-h)]");
    expect(html).toContain('aria-live="polite"');
    // Вычет высоты грани растёт вместе со слотом — иначе карточка прыгала бы.
    expect(html).toContain('data-outcome=""');
  });

  it("режим без записи (свободная тренировка) слота не получает вовсе", () => {
    const html = renderDeck({ flipped: true });
    expect(html).not.toContain("h-[var(--deck-outcome-h)]");
    expect(html).not.toContain("data-outcome");
  });

  it("«Знаю» и «Сомневаюсь» подтверждаются без дат и без ссылки на урок", () => {
    for (const grade of ["good", "hard"] as DeckGrade[]) {
      const html = renderDeck({
        flipped: true,
        outcome: { grade, itemId: item.id, lessonId: "lesson-7" },
      });
      expect(html).toContain("Записано, карточка ушла на следующий круг");
      expect(html).not.toContain("Перечитать урок");
    }
  });

  it("«Не знаю» зовёт перечитать урок, а без урока обходится без ссылки", () => {
    const withLesson = renderDeck({ flipped: true, outcome });
    expect(withLesson).toContain("Эта карточка вернётся ещё раз");
    expect(withLesson).toContain("Перечитать урок");
    expect(withLesson).toContain('href="/lessons/lesson-7"');

    const withoutLesson = renderDeck({
      flipped: true,
      outcome: { ...outcome, lessonId: null },
    });
    expect(withoutLesson).toContain("Эта карточка вернётся ещё раз");
    expect(withoutLesson).not.toContain("Перечитать урок");
  });

  it("полоса не переживает переход: она привязана к карточке, на которой видна", () => {
    // Тот же outcome, но карточка уже другая — слот пуст, текста нет.
    const html = renderDeck({
      flipped: true,
      item: { ...item, id: "card-2" },
      outcome,
    });
    expect(html).toContain("h-[var(--deck-outcome-h)]");
    expect(html).not.toContain("Эта карточка вернётся ещё раз");
    expect(html).not.toContain("Перечитать урок");
  });
});

// --- Кнопки оценок (заход C.8) ----------------------------------------------

describe("кнопки оценок", () => {
  it("рабочий размер, цвет оценки и подсказка клавиши на десктопе", () => {
    const html = render(true);
    expect(html).toContain("min-h-[52px]");
    // Ниже 700px кнопки в одну колонку, подсказки клавиш скрыты.
    expect(html).toContain("max-[699px]:grid-cols-1");
    expect(html).toContain("max-[699px]:hidden");
    for (const token of ["var(--danger)", "var(--warning)", "var(--success)"]) {
      expect(html).toContain(token);
    }
    for (const key of [">1<", ">2<", ">3<"]) {
      expect(html).toContain(key);
    }
  });

  it("«Показать ответ» — рамка --border-strong, на ховере --accent", () => {
    const html = render(false);
    expect(html).toContain("min-h-[50px]");
    expect(html).toContain("border-border-strong");
    expect(html).toContain("hover:border-accent");
  });

  it("новые пропсы не влияют на оценку: кнопки живы, pending их гасит", () => {
    // Ритм, ступень, источник и подтверждение — только рисунок; путь оценки
    // (кнопки, клавиши, жест) остаётся ровно тем же.
    const rich = renderDeck({
      flipped: true,
      grades: ["good", "again", "hard"],
      step: 0,
      sourceLabel: "Из урока «Метрики»",
      outcome,
    });
    expect(rich).toContain('aria-label="Оценка карточки"');
    expect((rich.match(/max-md:min-h-\[52px\]/g) ?? []).length).toBe(3);
    expect(rich).not.toContain("disabled=");

    const busy = renderDeck({ flipped: true, grades: ["good"], step: 0, outcome, pending: true });
    expect((busy.match(/disabled=""/g) ?? []).length).toBe(3);
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
  return renderDeck({
    item: {
      ...item,
      category: { title: "Вопросы о профессиональных интересах и ожиданиях", colorIndex: 3 },
    },
    index: 5,
    note,
  });
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

  it("без пояснения режима второй строки нет", () => {
    expect(renderHeader()).not.toContain("mt-0.5 text-[12px]");
  });

  it("ритм живёт в той же липкой шапке, что и счётчик", () => {
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
