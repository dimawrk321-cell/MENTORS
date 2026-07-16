import type { ReactNode } from "react";
import Link from "next/link";
import { requireInterviewerZone } from "@/lib/auth/guards";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "MENTORS";

export default async function InterviewerLayout({ children }: { children: ReactNode }) {
  // Layout guard (spec 3): is_interviewer flag only (spec 2).
  await requireInterviewerZone();

  return (
    <div className="min-h-dvh">
      <header className="border-border flex h-14 items-center justify-between gap-4 border-b px-4 md:px-8">
        <div className="flex items-center gap-5">
          <span className="text-[15px] font-semibold tracking-tight">{brandName}</span>
          <nav aria-label="Кабинет интервьюера" className="flex items-center gap-4">
            <Link
              href="/interviewer/schedule"
              className="text-text-2 ease-app hover:text-text-1 text-[13px] transition-colors duration-150"
            >
              Расписание
            </Link>
            <Link
              href="/interviewer/bookings"
              className="text-text-2 ease-app hover:text-text-1 text-[13px] transition-colors duration-150"
            >
              Брони
            </Link>
          </nav>
        </div>
        <Link
          href="/admin"
          className="text-text-2 ease-app hover:text-text-1 text-[13px] transition-colors duration-150"
        >
          В админку
        </Link>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
