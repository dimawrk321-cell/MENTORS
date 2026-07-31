import type { ReactNode } from "react";
import Link from "next/link";
import { NotificationBell } from "@/components/features/notification-bell";
import { ThemeToggleIcon } from "@/components/features/theme-toggle";
import { BrandMark } from "@/components/layout/brand-mark";
import { InterviewerNav } from "@/components/layout/interviewer-nav";
import { requireInterviewerZone } from "@/lib/auth/guards";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";

export default async function InterviewerLayout({ children }: { children: ReactNode }) {
  // Layout guard (spec 3): is_interviewer flag only (spec 2).
  const { user } = await requireInterviewerZone();

  return (
    <div className="min-h-dvh">
      <header className="border-border flex h-14 items-center justify-between gap-4 border-b px-4 md:px-8">
        <div className="flex min-w-0 items-center gap-5">
          <div className="flex shrink-0 items-center gap-2">
            <BrandMark brandName={brandName} tileSize={22} />
            {/* Zone marker (design handoff): outline pill next to the brand. */}
            <span className="rounded-pill border-border text-text-3 hidden border px-2 py-px text-[11px] sm:inline">
              Интервьюер
            </span>
          </div>
          <InterviewerNav />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggleIcon initialTheme={user.theme} className="size-8" />
          <NotificationBell />
          <Link
            href="/admin"
            className="text-text-2 ease-app hover:text-text-1 hidden text-[13px] transition-colors duration-150 sm:inline"
          >
            В админку
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
