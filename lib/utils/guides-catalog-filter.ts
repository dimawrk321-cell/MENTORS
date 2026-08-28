// Правило фильтрации каталога справочника (заход C.7 «Справочник по референсу
// v2»). Вынесено из клиентского островка чистой функцией по образцу
// `course-program-filter` из захода B.5: правило, от которого зависит, что
// ученик увидит на экране, закрепляется тестом, а не только вёрсткой.
//
// Здесь нет доступа: сервер уже отдал островку только те разделы, которые
// открыты ученику по флагам (spec 12.1/C3). Второй версии access-логики на
// клиенте не заводится — тот же довод, что в заходе «ручной выбор вопросов».

/** Значение фильтра разделов, означающее «не сужать». */
export const ALL_SECTIONS = "all";

export interface CatalogGuide {
  id: string;
  section: string;
  title: string;
  bookmarked: boolean;
}

export interface CatalogFilter {
  /** Сырой ввод поля поиска — нормализуется здесь, а не у вызывающего. */
  query: string;
  /** Ключ раздела или `ALL_SECTIONS`. */
  section: string;
  bookmarksOnly: boolean;
}

export interface CatalogGroup<T extends CatalogGuide> {
  section: string;
  guides: T[];
}

/**
 * Регистронезависимое сравнение по русской локали: у «Ё»/«ё» и «И»/«и»
 * побайтовое сравнение расходится с ожиданием читателя.
 */
function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

/**
 * Есть ли хоть одно сужение. От этого зависит и заголовок списка, и показ
 * карточки «Продолжить чтение»: в референсе она живёт только на чистом экране
 * (`hasContinue = !q && !bookmarksOnly && cat === 'all'`).
 */
export function isFilterActive(filter: CatalogFilter): boolean {
  return (
    normalize(filter.query).length > 0 || filter.section !== ALL_SECTIONS || filter.bookmarksOnly
  );
}

/** Поиск — по названию и только по нему (подстрока, а не префикс). */
export function filterGuides<T extends CatalogGuide>(guides: T[], filter: CatalogFilter): T[] {
  const query = normalize(filter.query);
  return guides.filter((guide) => {
    if (filter.section !== ALL_SECTIONS && guide.section !== filter.section) return false;
    if (filter.bookmarksOnly && !guide.bookmarked) return false;
    if (!query) return true;
    return normalize(guide.title).includes(query);
  });
}

/**
 * Группировка по разделам в заданном порядке. Пустые группы выпадают: раздел
 * без единого совпадения не должен оставлять на экране заголовок с нулём.
 */
export function groupGuides<T extends CatalogGuide>(
  guides: T[],
  sectionOrder: readonly string[],
): Array<CatalogGroup<T>> {
  return sectionOrder
    .map((section) => ({ section, guides: guides.filter((guide) => guide.section === section) }))
    .filter((group) => group.guides.length > 0);
}

/**
 * Счётчики для чипов. Считаются по ПОЛНОЙ выдаче, а не по отфильтрованной:
 * счётчик на чипе отвечает на вопрос «сколько там всего», иначе выбор раздела
 * обнулял бы все остальные чипы и выбрать второй раздел было бы нельзя.
 */
export function countBySection(
  guides: readonly CatalogGuide[],
  sectionOrder: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>(sectionOrder.map((section) => [section, 0]));
  for (const guide of guides) {
    const current = counts.get(guide.section);
    if (current !== undefined) counts.set(guide.section, current + 1);
  }
  return counts;
}
