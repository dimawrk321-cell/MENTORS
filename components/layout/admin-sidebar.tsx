"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartLine,
  FolderKanban,
  Gauge,
  Library,
  Megaphone,
  MessageCircleQuestion,
  ScrollText,
  Settings,
  Upload,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Spec 8.5: admin sections. Most routes do not exist yet at stage 0 —
// the global not-found page covers them until later stages.
const items: NavItem[] = [
  { href: "/admin", label: "Пульт", icon: Gauge },
  { href: "/admin/content", label: "Контент", icon: FolderKanban },
  { href: "/admin/questions", label: "Вопросы", icon: MessageCircleQuestion },
  { href: "/admin/students", label: "Ученики", icon: Users },
  { href: "/admin/interviews", label: "Интервью", icon: Video },
  { href: "/admin/library", label: "Библиотека", icon: Library },
  { href: "/admin/analytics", label: "Аналитика", icon: ChartLine },
  { href: "/admin/announcements", label: "Объявления", icon: Megaphone },
  { href: "/admin/settings", label: "Настройки", icon: Settings },
  { href: "/admin/audit", label: "Аудит", icon: ScrollText },
  { href: "/admin/import", label: "Импорт", icon: Upload },
];

/** Exact match for the admin root, prefix match for every other section. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Renders both variants: desktop sidebar (md+) and mobile horizontal chip row. */
export function AdminNav({ brandName }: { brandName: string }) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh shrink-0 border-r border-border px-3 py-5 md:flex md:w-56 md:flex-col gap-1">
        <div className="mb-4 px-3">
          <div className="text-[15px] font-semibold tracking-tight">{brandName}</div>
          <div className="text-[11px] text-text-3">Админка</div>
        </div>
        <nav aria-label="Разделы админки" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-3 rounded-control px-3 text-[14px] transition-colors duration-150 ease-app",
                  active ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
                )}
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile fallback: horizontal scrollable chip row (spec 13 allows
          horizontal scroll inside a container for admin on mobile). */}
      <nav
        aria-label="Разделы админки"
        className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2 md:hidden"
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 shrink-0 items-center whitespace-nowrap rounded-pill px-3 text-[13px] transition-colors duration-150 ease-app",
                active ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
