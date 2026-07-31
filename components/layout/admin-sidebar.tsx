"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ChartLine,
  FolderKanban,
  Gauge,
  Library,
  LogOut,
  Megaphone,
  Menu,
  MessageCircleQuestion,
  MonitorPlay,
  ScrollText,
  Settings,
  ShieldAlert,
  Upload,
  Users,
  UsersRound,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Role, Theme } from "@prisma/client";
import { cn } from "@/lib/utils/cn";
import { ADMIN_SECTIONS, type AdminSection, type Permission } from "@/lib/constants";
import { logoutAction } from "@/lib/actions/auth";
import { NotificationBell } from "@/components/features/notification-bell";
import { SearchTriggerBar, SearchTriggerIcon } from "@/components/features/search-trigger";
import { ThemeToggleIcon } from "@/components/features/theme-toggle";
import { BrandMark } from "@/components/layout/brand-mark";

const ROLE_LABEL: Record<Role, string> = {
  student: "Ученик",
  mentor: "Ментор",
  admin: "Админ",
  owner: "Владелец",
};

// Icons keyed by href — the ordered section list + permission gating live in
// ADMIN_SECTIONS (lib/constants, walk 12.4/B2), shared with firstAllowedAdminPath.
const SECTION_ICON: Record<string, LucideIcon> = {
  "/admin": Gauge,
  "/admin/content": FolderKanban,
  "/admin/questions": MessageCircleQuestion,
  "/admin/students": Users,
  "/admin/security": ShieldAlert,
  "/admin/interviews": Video,
  "/admin/library": Library,
  "/admin/analytics": ChartLine,
  "/admin/announcements": Megaphone,
  "/admin/settings": Settings,
  "/admin/team": UsersRound,
  "/admin/audit": ScrollText,
  "/admin/import": Upload,
};

// «Владелец» group (design handoff): owner/settings management tools get a group
// label above them. Import (content.manage) stays in the main list — it is a
// content action, not an owner tool, so it renders before the divider.
const OWNER_GROUP = new Set(["/admin/settings", "/admin/team", "/admin/audit"]);

const interviewerItem = {
  href: "/interviewer/schedule",
  label: "Кабинет интервьюера",
  icon: MonitorPlay,
};

/** Exact match for the admin root, prefix match for every other section. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** One nav row, shared by the desktop sidebar and the mobile drawer.
 * Active (design handoff): surface-2 fill + inset accent bar + accent icon —
 * the same treatment as the student sidebar. */
function NavLink({
  href,
  label,
  Icon,
  active,
  drawer = false,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  drawer?: boolean;
}) {
  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "ease-app flex shrink-0 items-center gap-3 transition-colors duration-150",
        drawer
          ? "h-[46px] rounded-[12px] px-3 text-[15px]"
          : "rounded-control h-9 px-3 text-[14px]",
        active
          ? "bg-surface-2 text-text-1 shadow-[inset_2px_0_0_var(--accent)]"
          : "text-text-2 hover:text-text-1",
      )}
    >
      <Icon size={18} strokeWidth={1.75} className={cn("shrink-0", active && "text-accent")} />
      <span className="truncate">{label}</span>
    </Link>
  );
  // In the drawer, a tap navigates AND closes the panel.
  return drawer ? <DialogPrimitive.Close asChild>{link}</DialogPrimitive.Close> : link;
}

/** The ordered nav body (main group → «Владелец» group → interviewer link),
 * rendered identically in the sidebar and the drawer. */
function NavBody({
  visible,
  pathname,
  isInterviewer,
  drawer = false,
}: {
  visible: AdminSection[];
  pathname: string;
  isInterviewer: boolean;
  drawer?: boolean;
}) {
  const main = visible.filter((s) => !OWNER_GROUP.has(s.href));
  const owner = visible.filter((s) => OWNER_GROUP.has(s.href));
  return (
    <>
      {main.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          Icon={SECTION_ICON[item.href]!}
          active={isActive(pathname, item.href)}
          drawer={drawer}
        />
      ))}
      {owner.length > 0 && (
        <>
          <div className="text-text-3 mt-2 px-3 pt-1 pb-1 text-[10px] font-semibold tracking-[0.08em] uppercase">
            Владелец
          </div>
          {owner.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              Icon={SECTION_ICON[item.href]!}
              active={isActive(pathname, item.href)}
              drawer={drawer}
            />
          ))}
        </>
      )}
      {isInterviewer && (
        <div className="border-border mt-2 flex flex-col border-t pt-2">
          <NavLink
            href={interviewerItem.href}
            label={interviewerItem.label}
            Icon={interviewerItem.icon}
            active={pathname.startsWith("/interviewer")}
            drawer={drawer}
          />
        </div>
      )}
    </>
  );
}

interface AdminNavProps {
  brandName: string;
  /** Viewer's effective permissions (walk 12.4/B2) — gates each section. */
  permissions: Permission[];
  isOwner: boolean;
  isInterviewer: boolean;
  userName: string;
  role: Role;
  theme: Theme;
}

/** Renders both variants: desktop sidebar (md+) and mobile header + drawer. */
export function AdminNav({
  brandName,
  permissions,
  isOwner,
  isInterviewer,
  userName,
  role,
  theme,
}: AdminNavProps) {
  const pathname = usePathname();
  const perms = new Set(permissions);
  const visible = ADMIN_SECTIONS.filter((section) =>
    section.ownerOnly ? isOwner : perms.has(section.permission!),
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="border-border sticky top-0 hidden h-dvh shrink-0 gap-1 border-r px-3 py-5 md:flex md:w-56 md:flex-col">
        <div className="mb-3 px-2">
          <BrandMark brandName={brandName} sublabel="Админка" tileSize={22} />
        </div>
        <SearchTriggerBar className="mb-2" />
        <nav
          aria-label="Разделы админки"
          className="flex flex-1 flex-col gap-[2px] overflow-y-auto"
        >
          <NavBody visible={visible} pathname={pathname} isInterviewer={isInterviewer} />
        </nav>
        {/* Current user + logout */}
        <div className="border-border mt-2 flex items-center gap-2 border-t px-3 pt-3">
          <div className="min-w-0 flex-1">
            <div className="text-text-1 truncate text-[13px]">{userName}</div>
            <div className="text-text-3 text-[11px]">{ROLE_LABEL[role]}</div>
          </div>
          {/* Quick theme toggle (spec 12.1/B1) — admin has no header bar.
              Bell (changelog 13.6): staff see incoming notifications in-zone. */}
          <NotificationBell className="size-8" />
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

      {/* Mobile top header (brand + search + burger) + full-height drawer. */}
      <header
        className="border-border bg-bg/85 sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-4 backdrop-blur md:hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)", paddingBottom: "12px" }}
      >
        <BrandMark brandName={brandName} sublabel="Админка" tileSize={24} />
        <div className="flex items-center gap-1.5">
          <NotificationBell className="border-border hover:border-border-strong size-10 rounded-[12px] border" />
          <SearchTriggerIcon className="border-border hover:border-border-strong size-10 rounded-[12px] border" />
          <DialogPrimitive.Root>
            <DialogPrimitive.Trigger
              aria-label="Меню"
              className="border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 flex size-10 items-center justify-center rounded-[12px] border transition-colors duration-150"
            >
              <Menu size={18} strokeWidth={1.75} />
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-[fade-in_150ms_var(--ease)] bg-black/50" />
              <DialogPrimitive.Content className="bg-bg border-border fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] animate-[fade-in_150ms_var(--ease)] flex-col border-r px-3 pt-3">
                <DialogPrimitive.Title className="sr-only">Разделы админки</DialogPrimitive.Title>
                <div className="mb-3 flex items-center justify-between px-1">
                  <BrandMark brandName={brandName} sublabel="Админка" tileSize={24} />
                  <DialogPrimitive.Close
                    aria-label="Закрыть"
                    className="border-border-strong bg-surface-2 text-text-2 ease-app hover:text-text-1 flex size-10 items-center justify-center rounded-[12px] border transition-colors duration-150"
                  >
                    <X size={18} strokeWidth={1.75} />
                  </DialogPrimitive.Close>
                </div>
                <nav
                  aria-label="Разделы админки"
                  className="flex flex-1 flex-col gap-[3px] overflow-y-auto"
                >
                  <NavBody
                    visible={visible}
                    pathname={pathname}
                    isInterviewer={isInterviewer}
                    drawer
                  />
                </nav>
                <div
                  className="border-border mt-2 flex items-center gap-2 border-t px-1 pt-3"
                  style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
                >
                  <span
                    className="rounded-pill flex size-[34px] shrink-0 items-center justify-center text-[13px] font-semibold"
                    style={{
                      background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                      color: "var(--accent)",
                    }}
                    aria-hidden="true"
                  >
                    {userName.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-text-1 truncate text-[13px]">{userName}</div>
                    <div className="text-text-3 text-[11px]">{ROLE_LABEL[role]}</div>
                  </div>
                  <ThemeToggleIcon initialTheme={theme} className="size-8" />
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      className="rounded-pill border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 flex h-8 items-center gap-1.5 border px-3 text-[12px] transition-colors duration-150"
                    >
                      <LogOut size={14} strokeWidth={1.75} />
                      Выйти
                    </button>
                  </form>
                </div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </header>
    </>
  );
}
