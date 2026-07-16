"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

// Content-studio tabs (spec 8.5): «Курсы» (course tree) and «Справочник» (guides
// CRUD) live in the same studio; this row switches between them.
const TABS = [
  { href: "/admin/content", label: "Курсы" },
  { href: "/admin/content/guides", label: "Справочник" },
] as const;

export function ContentStudioTabs() {
  const pathname = usePathname();
  return (
    <div className="border-border flex items-center gap-1 border-b">
      {TABS.map((tab) => {
        const active =
          tab.href === "/admin/content"
            ? pathname === "/admin/content" || pathname.startsWith("/admin/content/lessons")
            : pathname.startsWith("/admin/content/guides");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "ease-app -mb-px border-b-2 px-3 py-2 text-[14px] transition-colors duration-150",
              active
                ? "border-accent text-text-1"
                : "text-text-2 hover:text-text-1 border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
