import type { ReactNode } from "react";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "MENTORS";

export default function InterviewerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 md:px-8">
        <span className="text-[15px] font-semibold tracking-tight">{brandName}</span>
        <span className="text-[13px] text-text-2">Кабинет интервьюера</span>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</main>
    </div>
  );
}
