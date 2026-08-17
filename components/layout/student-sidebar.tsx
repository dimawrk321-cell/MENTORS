"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  BookOpen,
  Feather,
  FileText,
  Home,
  Layers,
  Library,
  MessageCircleQuestion,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SearchTriggerBar } from "@/components/features/search-trigger";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  SIDEBAR_STORAGE_KEY,
  isToggleSidebarHotkey,
  normalizeSidebarState,
  toggleSidebarState,
  type SidebarState,
} from "@/lib/sidebar-logic";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const mainItems: NavItem[] = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/courses", label: "Обучение", icon: BookOpen },
  { href: "/trainer", label: "Тренажёр", icon: Layers },
  { href: "/questions", label: "Вопросы", icon: MessageCircleQuestion },
  { href: "/mocks", label: "Моки", icon: Video },
  { href: "/guides", label: "Справочник", icon: BookMarked },
];

// Per-student toggled sections (spec 7.9/7.10, C3 flags) — inserted only when on.
const libraryItem: NavItem = { href: "/library", label: "Библиотека", icon: Library };
const resumeItem: NavItem = { href: "/resume", label: "Резюме", icon: FileText };
const legendItem: NavItem = { href: "/legend", label: "Легенда", icon: Feather };

const bottomItems: NavItem[] = [{ href: "/profile", label: "Профиль", icon: UserRound }];

/** Ширина, ниже которой рельс включён всегда (spec 13: планшет 768–1023). */
const RAIL_MEDIA_QUERY = "(max-width: 1023.98px)";

/** Exact match for the dashboard root, prefix match for every other section. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Тултип с названием — только в рельсе: иконка без подписи иначе нечитаема.
 * В развёрнутом виде подпись уже на экране, второй раз её показывать незачем.
 */
function RailTooltip({
  label,
  rail,
  children,
}: {
  label: string;
  rail: boolean;
  children: ReactNode;
}) {
  if (!rail) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarLink({ item, active, rail }: { item: NavItem; active: boolean; rail: boolean }) {
  const Icon = item.icon;
  return (
    <RailTooltip label={item.label} rail={rail}>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        // aria-label keeps the accessible name on the icon-only rail (spec 14).
        aria-label={item.label}
        className={cn(
          "student-sidebar-row rounded-control ease-app flex h-9 items-center gap-3 px-3 text-[14px] transition-colors duration-150",
          // Active (design handoff): surface-2 fill + inset accent bar + accent icon.
          // Индикатор живёт на самой строке, поэтому в рельсе он сохраняется.
          active
            ? "bg-surface-2 text-text-1 shadow-[inset_2px_0_0_var(--accent)]"
            : "text-text-2 hover:text-text-1",
        )}
      >
        <Icon size={18} strokeWidth={1.75} className={cn("shrink-0", active && "text-accent")} />
        <span className="student-sidebar-label truncate">{item.label}</span>
      </Link>
    </RailTooltip>
  );
}

export function StudentSidebar({
  brandName,
  libraryEnabled,
  guidesEnabled,
  guidesResumeEnabled,
  guidesLegendEnabled,
}: {
  brandName: string;
  libraryEnabled: boolean;
  /** D6 (spec 13.1): false hides «Справочник» when the student has no visible guides. */
  guidesEnabled: boolean;
  guidesResumeEnabled: boolean;
  guidesLegendEnabled: boolean;
}) {
  const pathname = usePathname();

  // Выбор ученика. Стартует «развёрнуто» и синхронизируется в эффекте, а НЕ в
  // инициализаторе useState: на сервере DOM недоступен, и любое другое значение
  // разошлось бы с серверной разметкой. Вспышки при этом нет — видимое
  // состояние держит CSS по `data-sidebar`, который инлайн-скрипт в
  // `app/layout.tsx` ставит до первой отрисовки. React-состояние отвечает
  // только за то, что раскладку не меняет: aria-expanded и тултипы.
  const [collapsed, setCollapsed] = useState(false);
  // Рельс включён либо выбором ученика, либо шириной планшета — ровно тем же
  // «или», что и в CSS. Нужен, чтобы тултипы появлялись всегда, когда подписи
  // спрятаны, а не только по кнопке.
  const [narrow, setNarrow] = useState(false);
  const rail = collapsed || narrow;

  const apply = useCallback((next: SidebarState) => {
    document.documentElement.dataset.sidebar = next;
    setCollapsed(next === "collapsed");
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
    } catch {
      // Приватный режим / отключённое хранилище: панель просто не переживёт
      // перезагрузку. Ронять навигацию из-за настройки вида нельзя.
    }
  }, []);

  // Первичная синхронизация с тем, что уже проставил инлайн-скрипт.
  useEffect(() => {
    setCollapsed(normalizeSidebarState(document.documentElement.dataset.sidebar) === "collapsed");
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(RAIL_MEDIA_QUERY);
    const read = () => setNarrow(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);

  // Горячая клавиша (см. DECISION в lib/sidebar-logic.ts).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isToggleSidebarHotkey(e)) return;
      e.preventDefault();
      apply(toggleSidebarState(normalizeSidebarState(document.documentElement.dataset.sidebar)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply]);

  // Библиотека sits right after Моки; Резюме/Легенда follow Справочник (spec 12.1).
  const items: NavItem[] = [
    ...mainItems.slice(0, 5),
    ...(libraryEnabled ? [libraryItem] : []),
    ...(guidesEnabled ? [mainItems[5]!] : []),
    ...(guidesResumeEnabled ? [resumeItem] : []),
    ...(guidesLegendEnabled ? [legendItem] : []),
  ];

  const toggleLabel = collapsed ? "Развернуть панель" : "Свернуть панель";

  return (
    // Собственная поверхность + волосяная граница (spec 5.1): панель отделена от
    // контента в обеих темах. Только токены — владелец подстроит в Claude Design.
    <aside
      id="student-sidebar"
      className="student-sidebar border-border bg-surface-1 sticky top-0 hidden h-dvh shrink-0 gap-1 border-r py-5 md:flex md:flex-col"
    >
      <TooltipProvider>
        <div className="student-sidebar-head mb-4 flex items-center justify-between gap-2 px-3 text-[15px] font-semibold tracking-tight">
          <span aria-hidden="true" className="student-sidebar-rail-only">
            {brandName.charAt(0)}
          </span>
          <span aria-hidden="true" className="student-sidebar-label truncate">
            {brandName}
          </span>
          {/* Доступное имя бренда живёт в отдельной копии и не зависит от того,
              какая из видимых копий сейчас показана. */}
          <span className="sr-only">{brandName}</span>
          <RailTooltip label={toggleLabel} rail={rail}>
            <button
              type="button"
              onClick={() =>
                apply(
                  toggleSidebarState(
                    normalizeSidebarState(document.documentElement.dataset.sidebar),
                  ),
                )
              }
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              aria-controls="student-sidebar"
              aria-keyshortcuts="Meta+Backslash Control+Backslash"
              // Кнопка живёт только там, где ей есть что переключать: ниже 1024
              // рельс держит медиазапрос (spec 13), и нажатие не изменило бы вид.
              className="text-text-2 ease-app hover:text-text-1 hidden size-8 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-150 lg:flex"
            >
              {/* Обе иконки в разметке всегда, показ решает CSS — иначе иконка
                  моргала бы при гидратации вместе с React-состоянием. */}
              <PanelLeftClose
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
                className="student-sidebar-label"
              />
              <PanelLeftOpen
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
                className="student-sidebar-rail-only"
              />
            </button>
          </RailTooltip>
        </div>
        {/* Search trigger (spec 7.11): opens the palette, hints ⌘K on desktop.
            В рельсе схлопывается в иконку — подпись и подсказка клавиши уходят
            тем же правилом, что подписи пунктов. */}
        <RailTooltip label="Поиск" rail={rail}>
          <SearchTriggerBar
            className="student-sidebar-row mb-2 px-3"
            labelClassName="student-sidebar-label"
          />
        </RailTooltip>
        <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1">
          {items.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              rail={rail}
            />
          ))}
          {/* «Профиль» остаётся внизу и в рельсе. */}
          <div className="mt-auto flex flex-col gap-1">
            {bottomItems.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                rail={rail}
              />
            ))}
          </div>
        </nav>
      </TooltipProvider>
    </aside>
  );
}
