"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Search } from "lucide-react";
import type { GuideNavItem } from "@/lib/services/guides";
import { GUIDE_SECTIONS, GUIDE_SECTION_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils/cn";

// Section sidebar (desktop) / accordion (mobile) for the guides zone (spec 7.10).

function groupBySection(guides: GuideNavItem[]): Array<{ section: string; items: GuideNavItem[] }> {
  return GUIDE_SECTIONS.map((section) => ({
    section,
    items: guides.filter((g) => g.section === section),
  })).filter((group) => group.items.length > 0);
}

function GuideLink({ item, active }: { item: GuideNavItem; active: boolean }) {
  return (
    <Link
      href={`/guides/${item.slug}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-control ease-app block px-3 py-1.5 text-[13px] transition-colors duration-150",
        active ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
      )}
    >
      {item.title}
    </Link>
  );
}

export function GuidesNav({ guides }: { guides: GuideNavItem[] }) {
  const pathname = usePathname();
  const groups = groupBySection(guides);
  const activeSlug = pathname.startsWith("/guides/") ? decodeURIComponent(pathname.slice(8)) : null;

  const search = (
    <form action="/guides" role="search" className="flex items-center gap-2">
      <div className="border-border focus-within:border-border-strong ease-app flex h-9 flex-1 items-center gap-2 rounded-[10px] border px-2.5 transition-colors duration-150">
        <Search size={15} strokeWidth={1.75} aria-hidden="true" className="text-text-3 shrink-0" />
        <input
          type="search"
          name="q"
          placeholder="Поиск по гайдам"
          aria-label="Поиск по гайдам"
          className="text-text-1 placeholder:text-text-3 h-full w-full min-w-0 bg-transparent text-[13px] outline-none"
        />
      </div>
    </form>
  );

  const bookmarksLink = (
    <Link
      href="/guides"
      className="rounded-control text-text-2 ease-app hover:text-text-1 flex items-center gap-2 px-3 py-1.5 text-[13px] transition-colors duration-150"
    >
      <Bookmark size={15} strokeWidth={1.75} aria-hidden="true" />
      Закладки
    </Link>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col gap-3 lg:flex">
        {search}
        {bookmarksLink}
        <nav aria-label="Разделы справочника" className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.section}>
              <div className="text-text-3 px-3 pb-1 text-[11px] font-medium tracking-wide uppercase">
                {GUIDE_SECTION_LABEL[group.section] ?? group.section}
              </div>
              <div className="flex flex-col">
                {group.items.map((item) => (
                  <GuideLink key={item.id} item={item} active={item.slug === activeSlug} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile accordion */}
      <div className="flex flex-col gap-3 lg:hidden">
        {search}
        {bookmarksLink}
        <nav aria-label="Разделы справочника" className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <details
              key={group.section}
              open={group.items.some((item) => item.slug === activeSlug)}
              className="rounded-card border-border bg-surface-1 border"
            >
              <summary className="text-text-1 cursor-pointer list-none px-3 py-2.5 text-[14px] font-medium">
                {GUIDE_SECTION_LABEL[group.section] ?? group.section}
              </summary>
              <div className="flex flex-col pb-1.5">
                {group.items.map((item) => (
                  <GuideLink key={item.id} item={item} active={item.slug === activeSlug} />
                ))}
              </div>
            </details>
          ))}
        </nav>
      </div>
    </>
  );
}
