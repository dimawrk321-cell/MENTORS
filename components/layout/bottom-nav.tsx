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
  Menu,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils/cn";
import { ThemeToggleTile } from "@/components/features/theme-toggle";
import type { Theme } from "@prisma/client";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Primary bottom-nav tabs (spec 13). «Ещё» opens a sheet with справочник,
// библиотека / резюме / легенда (if enabled), профиль and the theme toggle.
const mainItems: NavItem[] = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/courses", label: "Обучение", icon: BookOpen },
  { href: "/trainer", label: "Тренажёр", icon: Layers },
  { href: "/mocks", label: "Моки", icon: Video },
];

// Per-student toggled sections (spec 7.9/7.10, gated by the C3 flags).
const guidesItem: NavItem = { href: "/guides", label: "Справочник", icon: BookMarked };
const resumeItem: NavItem = { href: "/resume", label: "Резюме", icon: FileText };
const legendItem: NavItem = { href: "/legend", label: "Легенда", icon: Feather };
const libraryItem: NavItem = { href: "/library", label: "Библиотека", icon: Library };
const profileItem: NavItem = { href: "/profile", label: "Профиль", icon: UserRound };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({
  libraryEnabled,
  guidesResumeEnabled,
  guidesLegendEnabled,
  theme,
}: {
  libraryEnabled: boolean;
  guidesResumeEnabled: boolean;
  guidesLegendEnabled: boolean;
  theme: Theme;
}) {
  const pathname = usePathname();

  const moreItems: NavItem[] = [
    guidesItem,
    ...(guidesResumeEnabled ? [resumeItem] : []),
    ...(guidesLegendEnabled ? [legendItem] : []),
    ...(libraryEnabled ? [libraryItem] : []),
    profileItem,
  ];
  const moreActive = moreItems.some((item) => isActive(pathname, item.href));

  return (
    <nav
      aria-label="Основная навигация"
      className="border-border bg-bg fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex">
        {mainItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "ease-app flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors duration-150",
                active ? "text-text-1" : "text-text-3",
              )}
            >
              <Icon size={18} strokeWidth={1.75} />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Ещё"
              className={cn(
                "ease-app flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors duration-150",
                moreActive ? "text-text-1" : "text-text-3",
              )}
            >
              <Menu size={18} strokeWidth={1.75} />
              <span>Ещё</span>
            </button>
          </SheetTrigger>
          <SheetContent className="md:hidden">
            <SheetTitle>Ещё</SheetTitle>
            {/* Hub of large tiles (spec 12.2/1.3): sections by access flag + theme. */}
            <div className="grid grid-cols-2 gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-card ease-app flex min-h-[76px] flex-col justify-between gap-3 border p-3.5 transition-colors duration-150",
                        active
                          ? "border-border-strong bg-surface-2 text-text-1"
                          : "border-border bg-surface-1 text-text-2 hover:border-border-strong hover:bg-surface-2 hover:text-text-1",
                      )}
                    >
                      <Icon
                        size={22}
                        strokeWidth={1.75}
                        className={cn("shrink-0", active && "text-accent")}
                        aria-hidden="true"
                      />
                      <span className="text-text-1 text-[14px] font-medium">{item.label}</span>
                    </Link>
                  </SheetClose>
                );
              })}
              {/* Quick theme toggle (spec 12.1/B1) — mobile lives here; the profile
                  setting stays the source of truth. Not a link → no SheetClose. */}
              <ThemeToggleTile initialTheme={theme} />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
