"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const items = [
  { href: "/interviewer/schedule", label: "Расписание" },
  { href: "/interviewer/bookings", label: "Брони" },
];

/** Top-bar nav of the interviewer cabinet (design handoff): pill tabs, the
 *  active one filled with surface-2. */
export function InterviewerNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Кабинет интервьюера" className="flex items-center gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "ease-app flex h-8 items-center rounded-[8px] px-2.5 text-[13px] transition-colors duration-150",
              active ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
