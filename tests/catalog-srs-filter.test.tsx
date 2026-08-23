import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogGroup } from "@/lib/services/questions";
import {
  catalogFilterEmptyMessage,
  CatalogAccordion,
  filterCatalogGroups,
} from "@/components/features/catalog-accordion";

const groups: CatalogGroup[] = [
  {
    categoryId: "ml",
    title: "Classic ML",
    colorIndex: 0,
    questions: [
      {
        id: "new-1",
        teaser: "Новый вопрос",
        isShort: true,
        type: "open",
        difficulty: 1,
        lessonId: null,
      },
      {
        id: "srs-1",
        teaser: "Уже добавленный вопрос",
        isShort: true,
        type: "open",
        difficulty: 1,
        lessonId: null,
      },
    ],
  },
  {
    categoryId: "python",
    title: "Python",
    colorIndex: 1,
    questions: [
      {
        id: "srs-2",
        teaser: "Ещё один добавленный вопрос",
        isShort: true,
        type: "short_text",
        difficulty: 2,
        lessonId: null,
      },
    ],
  },
];

describe("фильтр ручного добавления вопросов в тренажёр", () => {
  const inSrs = new Set(["srs-1", "srs-2"]);

  it("«Не добавлены» оставляет только рабочую очередь и убирает пустые категории", () => {
    const result = filterCatalogGroups(groups, inSrs, "available");

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Classic ML");
    expect(result[0]!.questions.map((question) => question.id)).toEqual(["new-1"]);
  });

  it("«В тренажёре» показывает только вопросы с SRS-карточкой", () => {
    const result = filterCatalogGroups(groups, inSrs, "inSrs");

    expect(result.flatMap((group) => group.questions.map((question) => question.id))).toEqual([
      "srs-1",
      "srs-2",
    ]);
  });

  it("«Все» сохраняет исходную выдачу и оба состояния", () => {
    expect(filterCatalogGroups(groups, inSrs, "all")).toBe(groups);
  });

  it("после локального добавления вопрос уходит из очереди и входит в тренажёр", () => {
    const updated = new Set(inSrs).add("new-1");

    expect(filterCatalogGroups(groups, updated, "available")).toEqual([]);
    expect(
      filterCatalogGroups(groups, updated, "inSrs").flatMap((group) => group.questions),
    ).toHaveLength(3);
  });

  it("по умолчанию рендерит «Не добавлены» со всеми тремя актуальными счётчиками", () => {
    const html = renderToStaticMarkup(
      <CatalogAccordion groups={groups} inSrsIds={[...inSrs]} anyFilter resultKey="initial" />,
    );

    expect(html).toContain('aria-label="Фильтр по состоянию в тренажёре"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Не добавлены <span");
    expect(html).toContain(">1</span>");
    expect(html).toContain("В тренажёре <span");
    expect(html).toContain(">2</span>");
    expect(html).toContain("Все <span");
    expect(html).toContain(">3</span>");
    expect(html).toContain("Новый вопрос");
    expect(html).not.toContain("Уже добавленный вопрос");
  });

  it("показывает empty state, когда все вопросы текущей выдачи уже добавлены", () => {
    const html = renderToStaticMarkup(
      <CatalogAccordion
        groups={groups}
        inSrsIds={["new-1", "srs-1", "srs-2"]}
        anyFilter={false}
        resultKey="all-added"
      />,
    );

    expect(html).toContain("Все вопросы из этого раздела уже добавлены в тренажёр.");
  });

  it("называет пустое состояние тренажёра без утверждения, что вопрос выучен", () => {
    expect(catalogFilterEmptyMessage("inSrs")).toBe(
      "Ты пока не добавил вопросы из этого раздела в тренажёр.",
    );
  });
});
