"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BookMarked,
  BookOpen,
  Layers,
  Library,
  MessageCircleQuestion,
  PlayCircle,
  Search,
  Video,
  type LucideIcon,
} from "lucide-react";
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY } from "@/lib/constants";
import {
  filterActionsByQuery,
  groupLabel,
  isOpenPaletteHotkey,
  wrapIndex,
} from "@/lib/palette-logic";
import { cn } from "@/lib/utils/cn";

// CommandPalette (spec 5.3 / 7.11). Preloaded in the layout so opening is a pure
// state flip (<100ms); data is lazy. Cmd/Ctrl+K anywhere, or the header search
// icon, dispatch `OPEN_EVENT`. Full-screen sheet on mobile, top-anchored panel
// on desktop. ARIA combobox: role=dialog + listbox + aria-activedescendant.

export const OPEN_COMMAND_PALETTE_EVENT = "mentors:open-command-palette";

type GroupType = "lessons" | "questions" | "guides" | "recordings";

interface ApiItem {
  id: string;
  title: string;
  snippet: string;
  url: string;
  meta: string;
}
interface ApiGroup {
  type: GroupType;
  items: ApiItem[];
}
interface ApiResult {
  groups: ApiGroup[];
  fuzzy: boolean;
}
interface RecentEntry {
  type: GroupType;
  id: string;
  title: string;
  url: string;
}
interface HomeData {
  continueLesson: { title: string; url: string } | null;
  recent: RecentEntry[];
}

interface Row {
  key: string;
  title: string;
  snippet?: string;
  meta?: string;
  url: string;
  icon: LucideIcon;
}
interface Section {
  key: string;
  label: string;
  rows: Row[];
}

const GROUP_ICON: Record<GroupType, LucideIcon> = {
  lessons: BookOpen,
  questions: MessageCircleQuestion,
  guides: BookMarked,
  recordings: Library,
};

export function CommandPalette({ zone }: { zone: "student" | "admin" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const trimmed = query.trim();
  const isSearching = trimmed.length >= SEARCH_MIN_QUERY;

  // Open via Cmd/Ctrl+K anywhere, or the header trigger's custom event.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isOpenPaletteHotkey(e)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  // Reset transient state on close; lazily fetch the first-screen data on open.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResult(null);
      setActive(0);
      return;
    }
    let cancelled = false;
    fetch("/api/search/recent")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: HomeData | null) => {
        if (!cancelled && data) setHome(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Debounced query → /api/search. AbortController drops stale in-flight calls.
  useEffect(() => {
    if (!isSearching) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { groups: [], fuzzy: false }))
        .then((data: ApiResult) => {
          setResult(data);
          setLoading(false);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, isSearching]);

  // Static actions (student zone only — spec 7.11). Filtered by substring while
  // searching; shown in full on the first screen.
  const actions = useMemo<Row[]>(() => {
    if (zone !== "student") return [];
    const rows: Row[] = [];
    if (home?.continueLesson) {
      rows.push({
        key: "act:continue",
        title: "Продолжить урок",
        meta: home.continueLesson.title,
        url: home.continueLesson.url,
        icon: PlayCircle,
      });
    }
    rows.push(
      { key: "act:repeat", title: "Начать повторения", url: "/trainer/session", icon: Layers },
      { key: "act:mock", title: "Забронировать мок", url: "/mocks/book", icon: Video },
      { key: "act:bookmarks", title: "Мои закладки", url: "/guides", icon: BookMarked },
    );
    return rows;
  }, [zone, home]);

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = [];
    if (isSearching) {
      const matchedActions = filterActionsByQuery(actions, trimmed);
      if (matchedActions.length > 0)
        out.push({ key: "actions", label: "Действия", rows: matchedActions });
      const groups = result?.groups ?? [];
      for (const g of groups) {
        out.push({
          key: g.type,
          label: groupLabel(g.type, result?.fuzzy ?? false),
          rows: g.items.map((it) => ({
            key: `${g.type}:${it.id}`,
            title: it.title,
            snippet: it.snippet || undefined,
            meta: it.meta || undefined,
            url: it.url,
            icon: GROUP_ICON[g.type],
          })),
        });
      }
    } else {
      if (actions.length > 0) out.push({ key: "actions", label: "Действия", rows: actions });
      if (home && home.recent.length > 0) {
        out.push({
          key: "recent",
          label: "Недавнее",
          rows: home.recent.map((r) => ({
            key: `recent:${r.type}:${r.id}`,
            title: r.title,
            url: r.url,
            icon: GROUP_ICON[r.type],
          })),
        });
      }
    }
    return out;
  }, [isSearching, trimmed, actions, result, home]);

  // Flatten for keyboard navigation; each row gets a stable option id.
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  useEffect(() => {
    setActive((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)));
  }, [flat.length]);

  const optionId = (key: string) => `${listboxId}-opt-${key}`;
  const activeKey = flat[active]?.key;

  const go = useCallback(
    (url: string) => {
      setOpen(false);
      router.push(url);
    },
    [router],
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => wrapIndex(i, flat.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => wrapIndex(i, flat.length, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = flat[active];
      if (row) go(row.url);
    }
  }

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!activeKey || !listRef.current) return;
    const el = listRef.current.querySelector(`#${CSS.escape(optionId(activeKey))}`);
    el?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  const showEmpty = isSearching && !loading && flat.length === 0;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-[fade-in_150ms_var(--ease)] bg-black/50" />
        <DialogPrimitive.Content
          aria-label="Поиск"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className={cn(
            "bg-surface-2 border-border fixed z-50 flex flex-col overflow-hidden",
            // Mobile: full-screen sheet, field on top (spec 13).
            "inset-0 rounded-none border-0",
            // Desktop: top-anchored panel.
            "sm:inset-auto sm:top-[12vh] sm:left-1/2 sm:h-auto sm:max-h-[70vh] sm:w-[min(92vw,40rem)]",
            "sm:rounded-card sm:shadow-surface-2 sm:-translate-x-1/2 sm:border",
            "animate-[fade-in_150ms_var(--ease)]",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Поиск по платформе</DialogPrimitive.Title>
          {/* Search field */}
          <div className="border-border flex items-center gap-2 border-b px-4">
            <Search
              size={18}
              strokeWidth={1.75}
              className="text-text-3 shrink-0"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-activedescendant={activeKey ? optionId(activeKey) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              placeholder="Поиск по урокам, вопросам, гайдам, записям…"
              className="text-text-1 placeholder:text-text-3 h-14 flex-1 bg-transparent text-[16px] outline-none"
            />
            <DialogPrimitive.Close
              aria-label="Закрыть"
              className="text-text-3 hover:text-text-1 hidden shrink-0 rounded-[6px] px-2 py-1 text-[12px] transition-colors duration-150 sm:block"
            >
              Esc
            </DialogPrimitive.Close>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label="Результаты поиска"
            className="flex-1 overflow-y-auto overscroll-contain p-2"
          >
            {showEmpty ? (
              <div className="px-3 py-10 text-center">
                <p className="text-text-1 text-[15px]">Ничего не нашлось</p>
                <p className="text-text-3 mt-1 text-[13px]">
                  Проверь опечатки или попробуй другие слова.
                </p>
              </div>
            ) : (
              sections.map((section) => (
                <div key={section.key} className="mb-1">
                  <div className="text-text-3 px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">
                    {section.label}
                  </div>
                  {section.rows.map((row) => {
                    const isActive = row.key === activeKey;
                    return (
                      <div
                        key={row.key}
                        id={optionId(row.key)}
                        role="option"
                        aria-selected={isActive}
                        onClick={() => go(row.url)}
                        onMouseMove={() => {
                          const idx = flat.findIndex((f) => f.key === row.key);
                          if (idx >= 0) setActive(idx);
                        }}
                        className={cn(
                          "rounded-control flex cursor-pointer items-start gap-3 px-3 py-2",
                          isActive ? "bg-surface-1" : "",
                        )}
                      >
                        <row.icon
                          size={16}
                          strokeWidth={1.75}
                          aria-hidden="true"
                          className="text-text-3 mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-text-1 truncate text-[14px]">{row.title}</div>
                          {row.snippet && (
                            <div
                              className="search-snippet text-text-3 mt-0.5 line-clamp-2 text-[12px]"
                              // Safe: server escapes content, only <mark> survives (spec 7.11).
                              dangerouslySetInnerHTML={{ __html: row.snippet }}
                            />
                          )}
                          {row.meta && !row.snippet && (
                            <div className="text-text-3 mt-0.5 truncate text-[12px]">
                              {row.meta}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
