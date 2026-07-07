"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  BookOpen,
  Home,
  Layers,
  Library,
  MessageCircleQuestion,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// DECISION: several targets (/trainer, /questions, /mocks, /library, /guides, /profile)
// do not exist yet at stage 0 — links intentionally point ahead; the global not-found
// page covers them until those routes land in later stages.
const mainItems: NavItem[] = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/courses", label: "Обучение", icon: BookOpen },
  { href: "/trainer", label: "Тренажёр", icon: Layers },
  { href: "/questions", label: "Вопросы", icon: MessageCircleQuestion },
  { href: "/mocks", label: "Моки", icon: Video },
  { href: "/library", label: "Библиотека", icon: Library },
  { href: "/guides", label: "Справочник", icon: BookMarked },
];

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

export function StudentSidebar({ brandName }: { brandName: string }) {
  const pathname = usePathname();

  return (
    <aside className="border-border sticky top-0 hidden h-dvh shrink-0 gap-1 border-r px-3 py-5 md:flex md:w-16 md:flex-col lg:w-60">
      <div className="mb-4 px-3 text-[15px] font-semibold tracking-tight">
        <span aria-hidden="true" className="lg:hidden">
          {brandName.charAt(0)}
        </span>
        {/* Full brand name stays in the accessibility tree on the tablet rail. */}
        <span className="sr-only lg:not-sr-only">{brandName}</span>
      </div>
      <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1">
        {mainItems.map((item) => (
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
