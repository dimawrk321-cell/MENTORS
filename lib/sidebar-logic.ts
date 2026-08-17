// Боковая панель ученика (заход B.3): чистая логика состояния и горячей клавиши.
// Браузерных API здесь нет намеренно — то же разделение, что у `palette-logic.ts`:
// предикат и нормализация покрыты Vitest, а DOM живёт в компоненте (jsdom в
// проекте нет, spec 3 «юнит-тесты бизнес-логики»).

/** Ключ в localStorage. Тем же приёмом, что тема (spec 5.1, анти-FOUC). */
export const SIDEBAR_STORAGE_KEY = "sidebar";

/** Значение атрибута `data-sidebar` на `<html>`; им же рулит CSS-рельс. */
export type SidebarState = "expanded" | "collapsed";

/**
 * Всё, что не «collapsed», читается как «expanded» — включая пустой localStorage
 * у нового ученика и мусор от постороннего кода. Свёрнутая панель это осознанный
 * выбор, поэтому дефолт — развёрнутая.
 */
export function normalizeSidebarState(raw: string | null | undefined): SidebarState {
  return raw === "collapsed" ? "collapsed" : "expanded";
}

export function toggleSidebarState(state: SidebarState): SidebarState {
  return state === "collapsed" ? "expanded" : "collapsed";
}

/**
 * Cmd+\ (mac) / Ctrl+\ (win/linux) переключает панель.
 *
 * DECISION (выбор клавиши): `\` не конфликтует ни с ⌘K командной палитры
 * (`palette-logic.ts`), ни с клавишами тренажёра — там голые `Space` и `1/2/3`
 * без модификаторов (`session-card-deck.tsx`), а сама сессия вообще живёт в
 * focused-зоне без сайдбара. Ctrl+\ не занят ни Chrome, ни Firefox, ни Edge.
 * Alt/Shift отбиваются явно, чтобы не отбирать соседние сочетания.
 *
 * `code === "Backslash"` — вторая ветка ради раскладок, где `key` не даёт `\`:
 * физическая клавиша та же, и на русской раскладке Windows тоже.
 */
export function isToggleSidebarHotkey(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  key: string;
  code?: string;
}): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (e.altKey || e.shiftKey) return false;
  return e.key === "\\" || e.code === "Backslash";
}
