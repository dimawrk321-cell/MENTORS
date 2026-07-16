"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  BookOpen,
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

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Primary bottom-nav tabs (spec 13). «Ещё» opens a sheet with справочник,
// библиотека (if enabled) and профиль — достижения join at V1.
const mainItems: NavItem[] = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/courses", label: "Обучение", icon: BookOpen },
  { href: "/trainer", label: "Тренажёр", icon: Layers },
  { href: "/mocks", label: "Моки", icon: Video },
];

/** Sections reachable through the «Ещё» sheet. */
const moreBaseItems: NavItem[] = [
  { href: "/guides", label: "Справочник", icon: BookMarked },
  { href: "/profile", label: "Профиль", icon: UserRound },
];
const libraryItem: NavItem = { href: "/library", label: "Библиотека", icon: Library };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({ libraryEnabled }: { libraryEnabled: boolean }) {
  const pathname = usePathname();

  const moreItems = libraryEnabled
    ? [moreBaseItems[0]!, libraryItem, moreBaseItems[1]!]
    : moreBaseItems;
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
            <div className="flex flex-col gap-1">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-control ease-app flex h-11 items-center gap-3 px-3 text-[15px] transition-colors duration-150",
                        active ? "bg-surface-1 text-text-1" : "text-text-2",
                      )}
                    >
                      <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                      {item.label}
                    </Link>
                  </SheetClose>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
