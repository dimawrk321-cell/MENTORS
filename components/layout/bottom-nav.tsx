"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Home, Layers, Menu, Video, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// DECISION: «Ещё» will open a sheet with справочник/библиотека/профиль at a later
// stage; for the stage-0 skeleton it links straight to /profile.
const items: NavItem[] = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/courses", label: "Обучение", icon: BookOpen },
  { href: "/trainer", label: "Тренажёр", icon: Layers },
  { href: "/mocks", label: "Моки", icon: Video },
  { href: "/profile", label: "Ещё", icon: Menu },
];

/** Exact match for the dashboard root, prefix match for every other section. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Основная навигация"
      className="border-border bg-bg fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex">
        {items.map((item) => {
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
      </div>
    </nav>
  );
}
