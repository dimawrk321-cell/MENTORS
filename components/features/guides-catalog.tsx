"use client";

import {
  useMemo,
  useState,
  useTransition,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, BookOpen, ChevronRight, Search, X } from "lucide-react";
import { toggleBookmarkAction } from "@/lib/actions/guides";
import { GUIDE_SECTION_LABEL } from "@/lib/constants";
import { pluralRu } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/ui/toast";
import { useViewOnly, VIEW_ONLY_TITLE } from "@/components/features/view-only";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export interface GuideCatalogItem {
  id: string;
  slug: string;
  section: string;
  title: string;
  minutes: number;
  isNew: boolean;
  bookmarked: boolean;
}

export interface GuideContinueItem extends GuideCatalogItem {
  chapter: number;
  chapterTotal: number;
}

interface GuidesCatalogProps {
  guides: GuideCatalogItem[];
  sectionOrder: string[];
  sectionColors: Record<string, string>;
  continueGuide: GuideContinueItem | null;
}

type GuideStyle = CSSProperties & { "--guide-cat": string };

export function GuidesCatalog({
  guides: initialGuides,
  sectionOrder,
  sectionColors,
  continueGuide: initialContinueGuide,
}: GuidesCatalogProps) {
  const viewOnly = useViewOnly();
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [bookmarks, setBookmarks] = useState(
    () => new Set(initialGuides.filter((guide) => guide.bookmarked).map((guide) => guide.id)),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const guides = initialGuides.map((guide) => ({ ...guide, bookmarked: bookmarks.has(guide.id) }));
  const visible = guides.filter((guide) => {
    if (section !== "all" && guide.section !== section) return false;
    if (bookmarksOnly && !guide.bookmarked) return false;
    return !normalizedQuery || guide.title.toLocaleLowerCase("ru").includes(normalizedQuery);
  });
  const groups = sectionOrder
    .map((key) => ({ key, guides: visible.filter((guide) => guide.section === key) }))
    .filter((group) => group.guides.length > 0);
  const sectionCounts = useMemo(
    () =>
      new Map(
        sectionOrder.map((key) => [
          key,
          initialGuides.filter((guide) => guide.section === key).length,
        ]),
      ),
    [initialGuides, sectionOrder],
  );
  const hasFilters = normalizedQuery.length > 0 || section !== "all" || bookmarksOnly;
  const showContinue = !hasFilters && initialContinueGuide !== null;

  function resetFilters(): void {
    setQuery("");
    setSection("all");
    setBookmarksOnly(false);
  }

  function toggleBookmark(guideId: string): void {
    if (viewOnly || pendingId) return;
    const wasBookmarked = bookmarks.has(guideId);
    setBookmarks((current) => {
      const next = new Set(current);
      if (wasBookmarked) next.delete(guideId);
      else next.add(guideId);
      return next;
    });
    setPendingId(guideId);
    startTransition(async () => {
      const result = await toggleBookmarkAction(guideId);
      if (!result?.ok) {
        setBookmarks((current) => {
          const next = new Set(current);
          if (wasBookmarked) next.add(guideId);
          else next.delete(guideId);
          return next;
        });
        if (result) toast({ title: result.error.message, variant: "danger" });
      } else {
        setBookmarks((current) => {
          const next = new Set(current);
          if (result.data.bookmarked) next.add(guideId);
          else next.delete(guideId);
          return next;
        });
      }
      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <Search
          size={18}
          strokeWidth={1.75}
          className="text-text-3 pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти гайд по названию"
          aria-label="Найти гайд по названию"
          className="border-border bg-surface-1 text-text-1 placeholder:text-text-3 focus:border-border-strong h-11 w-full rounded-[10px] border pr-11 pl-10 text-[14px] transition-colors outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Очистить поиск"
            className="text-text-3 hover:text-text-1 absolute top-0 right-0 flex size-11 items-center justify-center transition-colors"
          >
            <X size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Разделы">
        <FilterChip active={section === "all"} onClick={() => setSection("all")}>
          Все разделы <ChipCount>{initialGuides.length}</ChipCount>
        </FilterChip>
        {sectionOrder.map((key) => {
          const color = sectionColors[key];
          const active = section === key;
          return (
            <FilterChip
              key={key}
              active={active}
              onClick={() => setSection(active ? "all" : key)}
              style={color ? ({ "--guide-cat": color } as GuideStyle) : undefined}
              colored={Boolean(color)}
            >
              <span className="size-[7px] rounded-full bg-[var(--guide-cat)]" aria-hidden="true" />
              {GUIDE_SECTION_LABEL[key] ?? key} <ChipCount>{sectionCounts.get(key) ?? 0}</ChipCount>
            </FilterChip>
          );
        })}
        <FilterChip
          active={bookmarksOnly}
          onClick={() => setBookmarksOnly((value) => !value)}
          className="sm:ml-1"
        >
          <Bookmark
            size={13}
            strokeWidth={1.75}
            fill={bookmarksOnly ? "currentColor" : "none"}
            aria-hidden="true"
          />
          В закладках
        </FilterChip>
      </div>

      {showContinue && initialContinueGuide && (
        <ContinueCard
          guide={{ ...initialContinueGuide, bookmarked: bookmarks.has(initialContinueGuide.id) }}
        />
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
            {hasFilters ? "Результаты" : "Все гайды"}
          </h2>
          <span className="text-text-3 text-[12.5px]">
            {visible.length} {pluralRu(visible.length, "гайд", "гайда", "гайдов")}
          </span>
        </div>

        {groups.length === 0 ? (
          <Card>
            <EmptyState
              icon={Search}
              title="Ничего не нашлось"
              description="Попробуй другое название или сбрось выбранные фильтры."
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-[22px]">
            {groups.map((group) => (
              <GuideGroup
                key={group.key}
                section={group.key}
                color={sectionColors[group.key] ?? "var(--text-3)"}
                guides={group.guides}
                total={sectionCounts.get(group.key) ?? group.guides.length}
                pendingId={pendingId}
                viewOnly={viewOnly}
                onToggleBookmark={toggleBookmark}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FilterChip({
  active,
  colored = false,
  className,
  ...props
}: ComponentProps<"button"> & { active: boolean; colored?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-[30px] items-center gap-[7px] rounded-full border px-3 text-[12.5px] font-medium transition-colors",
        active
          ? colored
            ? "text-text-1 border-[color-mix(in_srgb,var(--guide-cat)_55%,var(--border))] bg-[color-mix(in_srgb,var(--guide-cat)_12%,transparent)]"
            : "border-border-strong bg-surface-2 text-text-1"
          : "border-border text-text-2 hover:border-border-strong hover:text-text-1 bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

function ChipCount({ children }: { children: ReactNode }) {
  return <span className="text-text-3 text-[11px] tabular-nums">{children}</span>;
}

function ContinueCard({ guide }: { guide: GuideContinueItem }) {
  const color = "var(--accent)";
  return (
    <Link
      href={`/guides/${guide.slug}`}
      style={{ "--guide-cat": color } as GuideStyle}
      className="group border-border bg-surface-1 hover:border-border-strong rounded-card flex items-center gap-3.5 border p-4 shadow-[var(--card-shadow)] transition-[border-color,transform] hover:-translate-y-px"
    >
      <span className="bg-accent/12 text-accent flex size-9 shrink-0 items-center justify-center rounded-[10px]">
        <BookOpen size={18} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-text-3 block text-[10.5px] font-semibold tracking-[0.08em] uppercase">
          Продолжить чтение
        </span>
        <span className="text-text-1 mt-0.5 block truncate text-[15px] font-semibold">
          {guide.title}
        </span>
        <span className="text-text-3 mt-1 flex flex-wrap gap-x-2 text-[12px]">
          <span>{GUIDE_SECTION_LABEL[guide.section] ?? guide.section}</span>
          <span aria-hidden="true">·</span>
          <span>
            Глава {guide.chapter} из {guide.chapterTotal}
          </span>
          <span aria-hidden="true">·</span>
          <span>{guide.minutes} мин</span>
        </span>
      </span>
      <ChevronRight
        className="text-text-3 group-hover:text-text-1 shrink-0"
        size={19}
        strokeWidth={1.75}
      />
    </Link>
  );
}

function GuideGroup({
  section,
  color,
  guides,
  total,
  pendingId,
  viewOnly,
  onToggleBookmark,
}: {
  section: string;
  color: string;
  guides: GuideCatalogItem[];
  total: number;
  pendingId: string | null;
  viewOnly: boolean;
  onToggleBookmark: (guideId: string) => void;
}) {
  return (
    <section style={{ "--guide-cat": color } as GuideStyle}>
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[7px] bg-[color-mix(in_srgb,var(--guide-cat)_14%,transparent)]">
          <span className="size-2 rounded-full bg-[var(--guide-cat)]" aria-hidden="true" />
        </span>
        <h3 className="text-[13.5px] font-semibold tracking-[-0.01em]">
          {GUIDE_SECTION_LABEL[section] ?? section}
        </h3>
        <span className="text-text-3 text-[12px]">
          {guides.length} из {total} {pluralRu(total, "гайда", "гайдов", "гайдов")}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {guides.map((guide) => (
          <GuideRow
            key={guide.id}
            guide={guide}
            pending={pendingId === guide.id}
            viewOnly={viewOnly}
            onToggleBookmark={onToggleBookmark}
          />
        ))}
      </div>
    </section>
  );
}

function GuideRow({
  guide,
  pending,
  viewOnly,
  onToggleBookmark,
}: {
  guide: GuideCatalogItem;
  pending: boolean;
  viewOnly: boolean;
  onToggleBookmark: (guideId: string) => void;
}) {
  const BookmarkIcon = guide.bookmarked ? BookmarkCheck : Bookmark;
  return (
    <div className="border-border bg-surface-1 hover:border-border-strong rounded-card group flex min-h-[62px] items-stretch border shadow-[var(--card-shadow)] transition-[border-color,transform] hover:-translate-y-px">
      <Link href={`/guides/${guide.slug}`} className="flex min-w-0 flex-1 items-center p-3.5">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-text-1 text-[14.5px] leading-[1.35] font-semibold tracking-[-0.01em]">
              {guide.title}
            </span>
            {guide.isNew && (
              <span className="border-violet/40 bg-violet/10 text-violet rounded-full border px-2 py-px text-[10px] font-semibold tracking-[0.04em] uppercase">
                новый
              </span>
            )}
          </span>
          <span className="text-text-3 mt-0.5 block text-[12px]">{guide.minutes} мин</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => onToggleBookmark(guide.id)}
        disabled={pending || viewOnly}
        title={viewOnly ? VIEW_ONLY_TITLE : undefined}
        aria-pressed={guide.bookmarked}
        aria-label={guide.bookmarked ? "Убрать из закладок" : "Добавить в закладки"}
        className={cn(
          "m-2 flex size-11 shrink-0 items-center justify-center rounded-[9px] transition-colors disabled:opacity-50 md:size-9",
          guide.bookmarked
            ? "bg-accent/12 text-accent"
            : "text-text-3 hover:bg-surface-2 hover:text-text-1",
        )}
      >
        <BookmarkIcon
          size={17}
          strokeWidth={1.75}
          fill={guide.bookmarked ? "currentColor" : "none"}
        />
      </button>
      <Link
        href={`/guides/${guide.slug}`}
        aria-label={`Открыть «${guide.title}»`}
        className="text-text-3 hover:text-text-1 mr-2 flex size-11 shrink-0 items-center justify-center md:size-9"
      >
        <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </div>
  );
}
