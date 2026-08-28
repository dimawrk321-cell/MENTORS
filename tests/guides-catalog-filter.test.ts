import { describe, expect, it } from "vitest";
import {
  ALL_SECTIONS,
  countBySection,
  filterGuides,
  groupGuides,
  isFilterActive,
  type CatalogFilter,
} from "@/lib/utils/guides-catalog-filter";

// Каталог справочника (заход C.7 «Справочник по референсу v2»). Закрепляет то,
// от чего зависит увиденное учеником: что попадает в выдачу, как она делится по
// разделам, что считают чипы и когда экран считается «чистым» — от последнего
// зависит показ карточки «Продолжить чтение».

const SECTION_ORDER = ["stages", "ask_interviewer", "job_search", "resume", "legend"];

const GUIDES = [
  { id: "1", section: "stages", title: "Скрининг: что спрашивают и зачем", bookmarked: true },
  { id: "2", section: "stages", title: "Лайвкодинг: как думать вслух", bookmarked: false },
  { id: "3", section: "ask_interviewer", title: "Что спросить интервьюера", bookmarked: false },
  { id: "4", section: "job_search", title: "Вилка: как называть", bookmarked: true },
  { id: "5", section: "resume", title: "Структура сильного резюме", bookmarked: false },
  { id: "6", section: "resume", title: "Резюме на английском", bookmarked: false },
];

const NO_FILTER: CatalogFilter = { query: "", section: ALL_SECTIONS, bookmarksOnly: false };

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

describe("isFilterActive", () => {
  it("чистый экран — фильтра нет", () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
  });

  it("пробелы в поле поиска фильтром не считаются", () => {
    // Иначе карточка «Продолжить чтение» пропадала бы от случайного пробела.
    expect(isFilterActive({ ...NO_FILTER, query: "   " })).toBe(false);
  });

  it.each([
    ["запрос", { ...NO_FILTER, query: "резюме" }],
    ["раздел", { ...NO_FILTER, section: "stages" }],
    ["закладки", { ...NO_FILTER, bookmarksOnly: true }],
  ])("%s включает фильтр", (_label, filter) => {
    expect(isFilterActive(filter as CatalogFilter)).toBe(true);
  });
});

describe("filterGuides", () => {
  it("без фильтра отдаёт всё в исходном порядке", () => {
    expect(ids(filterGuides(GUIDES, NO_FILTER))).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("сужает по разделу", () => {
    expect(ids(filterGuides(GUIDES, { ...NO_FILTER, section: "resume" }))).toEqual(["5", "6"]);
  });

  it("сужает по закладкам", () => {
    expect(ids(filterGuides(GUIDES, { ...NO_FILTER, bookmarksOnly: true }))).toEqual(["1", "4"]);
  });

  it("ищет по названию подстрокой и без учёта регистра", () => {
    expect(ids(filterGuides(GUIDES, { ...NO_FILTER, query: "РЕЗЮМЕ" }))).toEqual(["5", "6"]);
  });

  it("ищет по середине слова, а не только по началу", () => {
    expect(ids(filterGuides(GUIDES, { ...NO_FILTER, query: "кодинг" }))).toEqual(["2"]);
  });

  it("обрезает пробелы вокруг запроса", () => {
    expect(ids(filterGuides(GUIDES, { ...NO_FILTER, query: "  вилка  " }))).toEqual(["4"]);
  });

  it("складывает условия, а не заменяет одно другим", () => {
    const filter = { query: "скрининг", section: "stages", bookmarksOnly: true };
    expect(ids(filterGuides(GUIDES, filter))).toEqual(["1"]);
    // Тот же запрос в другом разделе не находит ничего — раздел не игнорируется.
    expect(filterGuides(GUIDES, { ...filter, section: "resume" })).toEqual([]);
  });

  it("промах даёт пустую выдачу, а не всю", () => {
    expect(filterGuides(GUIDES, { ...NO_FILTER, query: "щщщ" })).toEqual([]);
  });
});

describe("groupGuides", () => {
  it("держит порядок разделов из переданного списка, а не из данных", () => {
    const groups = groupGuides(GUIDES, SECTION_ORDER);
    expect(groups.map((group) => group.section)).toEqual([
      "stages",
      "ask_interviewer",
      "job_search",
      "resume",
    ]);
  });

  it("выбрасывает разделы без совпадений", () => {
    // legend в данных есть в порядке, но гайдов нет — заголовка с нулём быть не должно.
    const groups = groupGuides(
      filterGuides(GUIDES, { ...NO_FILTER, query: "резюме" }),
      SECTION_ORDER,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.section).toBe("resume");
    expect(ids(groups[0]!.guides)).toEqual(["5", "6"]);
  });

  it("раздел вне переданного порядка на экран не попадает", () => {
    // Гейтинг: сервер не кладёт в sectionOrder закрытые флагом разделы.
    const groups = groupGuides(GUIDES, ["stages", "ask_interviewer", "job_search"]);
    expect(groups.map((group) => group.section)).not.toContain("resume");
  });
});

describe("countBySection", () => {
  it("считает по полной выдаче, а не по отфильтрованной", () => {
    // Иначе выбор одного раздела обнулил бы счётчики остальных чипов.
    const counts = countBySection(GUIDES, SECTION_ORDER);
    expect(counts.get("stages")).toBe(2);
    expect(counts.get("resume")).toBe(2);
    expect(counts.get("job_search")).toBe(1);
  });

  it("раздел без гайдов получает ноль, а не отсутствует", () => {
    expect(countBySection(GUIDES, SECTION_ORDER).get("legend")).toBe(0);
  });

  it("не считает разделы, которых нет в порядке", () => {
    const counts = countBySection(GUIDES, ["stages"]);
    expect([...counts.keys()]).toEqual(["stages"]);
    expect(counts.get("stages")).toBe(2);
  });
});
