import type { ReactNode } from "react";
import { StudentSidebar } from "@/components/layout/student-sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ImpersonationBanner } from "@/components/features/impersonation-banner";
import { CommandPalette } from "@/components/features/command-palette";
import { SearchTriggerIcon } from "@/components/features/search-trigger";
import { requireStudentZone } from "@/lib/auth/guards";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "MENTORS";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  // Layout guard (spec 3): active students only; expired → /expired, mentors+ → /admin.
  const { user, impersonated } = await requireStudentZone();

  return (
    <>
      {impersonated && <ImpersonationBanner studentName={user.name} />}
      <div className="flex min-h-dvh">
        <StudentSidebar brandName={brandName} libraryEnabled={user.libraryEnabled} />
        {/* pb-20 keeps content clear of the fixed bottom nav on mobile. */}
        <main className="flex-1 pb-20 md:pb-0">
          {/* Mobile header (spec 7.11): brand + search icon; desktop uses the sidebar. */}
          <header className="border-border bg-bg sticky top-0 z-30 flex items-center justify-between border-b px-4 py-2 md:hidden">
            <span className="text-[15px] font-semibold tracking-tight">{brandName}</span>
            <SearchTriggerIcon className="-mr-2" />
          </header>
          <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
        </main>
      </div>
      <BottomNav libraryEnabled={user.libraryEnabled} />
      {/* Preloaded palette: opening is a state flip, data is lazy (spec 5.3). */}
      <CommandPalette zone="student" />
    </>
  );
}
