"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartLine,
  FolderKanban,
  Gauge,
  Library,
  LogOut,
  Megaphone,
  MessageCircleQuestion,
  MonitorPlay,
  ScrollText,
  Settings,
  Upload,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { Role, Theme } from "@prisma/client";
import { cn } from "@/lib/utils/cn";
import { logoutAction } from "@/lib/actions/auth";
import { SearchTriggerBar, SearchTriggerIcon } from "@/components/features/search-trigger";
import { ThemeToggleIcon } from "@/components/features/theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Minimal role that sees the section (spec 8.5: mentor gets a filtered sidebar). */
  minRole: Role;
}

const ROLE_RANK: Record<Role, number> = { student: 0, mentor: 1, admin: 2, owner: 3 };

const ROLE_LABEL: Record<Role, string> = {
  student: "Ученик",
  mentor: "Ментор",
  admin: "Админ",
  owner: "Владелец",
};

// Spec 8.5 sections; roles per spec 2. Most routes do not exist yet at stage 1 —
// the global not-found page covers them until later stages.
// DECISION: import is admin+ — bulk content creation, not listed for mentors in spec 2.
const items: NavItem[] = [
  { href: "/admin", label: "Пульт", icon: Gauge, minRole: "mentor" },
  { href: "/admin/content", label: "Контент", icon: FolderKanban, minRole: "mentor" },
  { href: "/admin/questions", label: "Вопросы", icon: MessageCircleQuestion, minRole: "mentor" },
  { href: "/admin/students", label: "Ученики", icon: Users, minRole: "mentor" },
  { href: "/admin/interviews", label: "Интервью", icon: Video, minRole: "mentor" },
  { href: "/admin/library", label: "Библиотека", icon: Library, minRole: "mentor" },
  { href: "/admin/analytics", label: "Аналитика", icon: ChartLine, minRole: "mentor" },
  { href: "/admin/announcements", label: "Объявления", icon: Megaphone, minRole: "admin" },
  { href: "/admin/settings", label: "Настройки", icon: Settings, minRole: "admin" },
  { href: "/admin/audit", label: "Аудит", icon: ScrollText, minRole: "owner" },
  { href: "/admin/import", label: "Импорт", icon: Upload, minRole: "admin" },
];

const interviewerItem: Omit<NavItem, "minRole"> = {
  href: "/interviewer/schedule",
  label: "Кабинет интервьюера",
  icon: MonitorPlay,
};

/** Exact match for the admin root, prefix match for every other section. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface AdminNavProps {
  brandName: string;
  role: Role;
  isInterviewer: boolean;
  userName: string;
  theme: Theme;
}

/** Renders both variants: desktop sidebar (md+) and mobile horizontal chip row. */
export function AdminNav({ brandName, role, isInterviewer, userName, theme }: AdminNavProps) {
  const pathname = usePathname();
  const visible = items.filter((item) => ROLE_RANK[role] >= ROLE_RANK[item.minRole]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="border-border sticky top-0 hidden h-dvh shrink-0 gap-1 border-r px-3 py-5 md:flex md:w-56 md:flex-col">
        <div className="mb-4 px-3">
          <div className="text-[15px] font-semibold tracking-tight">{brandName}</div>
          <div className="text-text-3 text-[11px]">Админка</div>
        </div>
        <SearchTriggerBar className="mb-2" />
        <nav aria-label="Разделы админки" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-control ease-app flex h-9 shrink-0 items-center gap-3 px-3 text-[14px] transition-colors duration-150",
                  active ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
                )}
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
          {isInterviewer && (
            <Link
              href={interviewerItem.href}
              className={cn(
                "rounded-control border-border ease-app mt-2 flex h-9 shrink-0 items-center gap-3 border-t px-3 pt-2 text-[14px] transition-colors duration-150",
                pathname.startsWith("/interviewer")
                  ? "text-text-1"
                  : "text-text-2 hover:text-text-1",
              )}
            >
              <interviewerItem.icon size={18} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{interviewerItem.label}</span>
            </Link>
          )}
        </nav>
        {/* Current user + logout */}
        <div className="border-border mt-2 flex items-center gap-2 border-t px-3 pt-3">
          <div className="min-w-0 flex-1">
            <div className="text-text-1 truncate text-[13px]">{userName}</div>
            <div className="text-text-3 text-[11px]">{ROLE_LABEL[role]}</div>
          </div>
          {/* Quick theme toggle (spec 12.1/B1) — admin has no header bar. */}
          <ThemeToggleIcon initialTheme={theme} className="size-8" />
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Выйти"
              title="Выйти"
              className="rounded-control text-text-3 ease-app hover:bg-surface-2 hover:text-text-1 flex size-8 items-center justify-center transition-colors duration-150"
            >
              <LogOut size={16} strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile fallback: horizontal scrollable chip row (spec 13 allows
          horizontal scroll inside a container for admin on mobile). */}
      <nav
        aria-label="Разделы админки"
        className="border-border flex items-center gap-1 overflow-x-auto border-b px-4 py-2 md:hidden"
      >
        <SearchTriggerIcon className="size-9 shrink-0" />
        {visible.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-pill ease-app flex h-8 shrink-0 items-center px-3 text-[13px] whitespace-nowrap transition-colors duration-150",
                active ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
              )}
            >
              {item.label}
            </Link>
          );
        })}
        {isInterviewer && (
          <Link
            href={interviewerItem.href}
            className="rounded-pill text-text-2 ease-app hover:text-text-1 flex h-8 shrink-0 items-center px-3 text-[13px] whitespace-nowrap transition-colors duration-150"
          >
            {interviewerItem.label}
          </Link>
        )}
        <ThemeToggleIcon initialTheme={theme} className="size-8 shrink-0" />
        <form action={logoutAction} className="shrink-0">
          <button
            type="submit"
            aria-label="Выйти"
            className="rounded-pill text-text-2 ease-app hover:text-text-1 flex h-8 items-center gap-1.5 px-3 text-[13px] transition-colors duration-150"
          >
            <LogOut size={14} strokeWidth={1.75} />
            Выйти
          </button>
        </form>
      </nav>
    </>
  );
}
