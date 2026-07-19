"use client";

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
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { SearchTriggerBar } from "@/components/features/search-trigger";

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

/** Exact match for the dashboard root, prefix match for every other section. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      // aria-label keeps the accessible name on the icon-only tablet rail (spec 14).
      aria-label={item.label}
      className={cn(
        "rounded-control ease-app flex h-9 items-center gap-3 px-3 text-[14px] transition-colors duration-150",
        active ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
      )}
    >
      <Icon size={18} strokeWidth={1.75} className="shrink-0" />
      {/* Tablet (md) shows an icon-only rail; labels return on lg. */}
      <span className="truncate md:hidden lg:inline">{item.label}</span>
    </Link>
  );
}

export function StudentSidebar({
  brandName,
  libraryEnabled,
  guidesResumeEnabled,
  guidesLegendEnabled,
}: {
  brandName: string;
  libraryEnabled: boolean;
  guidesResumeEnabled: boolean;
  guidesLegendEnabled: boolean;
}) {
  const pathname = usePathname();
  // Библиотека sits right after Моки; Резюме/Легенда follow Справочник (spec 12.1).
  const items: NavItem[] = [
    ...mainItems.slice(0, 5),
    ...(libraryEnabled ? [libraryItem] : []),
    mainItems[5]!,
    ...(guidesResumeEnabled ? [resumeItem] : []),
    ...(guidesLegendEnabled ? [legendItem] : []),
  ];

  return (
    <aside className="border-border sticky top-0 hidden h-dvh shrink-0 gap-1 border-r px-3 py-5 md:flex md:w-16 md:flex-col lg:w-60">
      <div className="mb-4 px-3 text-[15px] font-semibold tracking-tight">
        <span aria-hidden="true" className="lg:hidden">
          {brandName.charAt(0)}
        </span>
        {/* Full brand name stays in the accessibility tree on the tablet rail. */}
        <span className="sr-only lg:not-sr-only">{brandName}</span>
      </div>
      {/* Search trigger (spec 7.11): opens the palette, hints ⌘K on desktop. */}
      <SearchTriggerBar className="mb-2 md:px-0 lg:px-3" />
      <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
        <div className="mt-auto flex flex-col gap-1">
          {bottomItems.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </nav>
    </aside>
  );
}
