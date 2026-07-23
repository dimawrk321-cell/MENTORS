import type { ReactNode } from "react";
import { StudentSidebar } from "@/components/layout/student-sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ImpersonationBanner } from "@/components/features/impersonation-banner";
import { CommandPalette } from "@/components/features/command-palette";
import { SearchTriggerIcon } from "@/components/features/search-trigger";
import { NotificationBell } from "@/components/features/notification-bell";
import { ThemeToggleIcon } from "@/components/features/theme-toggle";
import { AnnouncementBanners } from "@/components/features/announcement-banners";
import { EmailVerifyBanner } from "@/components/features/email-verify-banner";
import { OfflineBanner } from "@/components/features/offline-banner";
import { prisma } from "@/lib/db";
import { getActiveBannersForUser } from "@/lib/services/announcements";
import { hasVisibleGuides } from "@/lib/services/guides";
import { requireStudentZone } from "@/lib/auth/guards";
import { EMAIL_VERIFICATION_UI_ENABLED } from "@/lib/constants";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  // Layout guard (spec 3): active students only; expired → /expired, mentors+ → /admin.
  const { user, impersonated } = await requireStudentZone();
  // Active banners in this student's segment (spec 8.5).
  const [banners, guidesEnabled] = await Promise.all([
    getActiveBannersForUser(prisma, user.id),
    // D6 (spec 13.1): hide «Справочник» when the student has no reachable guides.
    hasVisibleGuides(prisma, {
      resume: user.guidesResumeEnabled,
      legend: user.guidesLegendEnabled,
    }),
  ]);

  return (
    <>
      <OfflineBanner />
      {impersonated && <ImpersonationBanner studentName={user.name} />}
      <div className="flex min-h-dvh">
        <StudentSidebar
          brandName={brandName}
          libraryEnabled={user.libraryEnabled}
          guidesEnabled={guidesEnabled}
          guidesResumeEnabled={user.guidesResumeEnabled}
          guidesLegendEnabled={user.guidesLegendEnabled}
        />
        {/* pb-20 keeps content clear of the fixed bottom nav on mobile.
            min-w-0: a flex item defaults to min-width:auto, so without this a
            wide child (video, table, code, KaTeX) bursts the page horizontally
            at 390px (spec 13 / stage 12 mobile debt). */}
        <main className="min-w-0 flex-1 pb-20 md:pb-0">
          {/* Header (spec 7.11/7.12): brand + bell + search on mobile; on desktop
              nav lives in the sidebar, so the bar carries only the bell. */}
          <header className="border-border bg-bg/85 sticky top-0 z-30 flex items-center justify-between gap-2 border-b px-4 py-2 backdrop-blur md:justify-end md:px-8">
            <span className="text-[15px] font-semibold tracking-tight md:hidden">{brandName}</span>
            <div className="flex items-center gap-1">
              <ThemeToggleIcon initialTheme={user.theme} className="hidden md:flex" />
              <NotificationBell />
              <SearchTriggerIcon className="-mr-2 md:hidden" />
            </div>
          </header>
          {/* B4 (spec 13.1): 5xl→6xl (1024→1152px) so wide displays gain density
              instead of growing side gutters; reading pages self-cap at 680px. */}
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
            {/* D1 (spec 13.1): email verification is @dormant — the banner is gated off. */}
            {EMAIL_VERIFICATION_UI_ENABLED && !user.emailVerifiedAt && user.status === "active" && (
              <EmailVerifyBanner />
            )}
            <AnnouncementBanners banners={banners} />
            {children}
          </div>
        </main>
      </div>
      <BottomNav
        libraryEnabled={user.libraryEnabled}
        guidesEnabled={guidesEnabled}
        guidesResumeEnabled={user.guidesResumeEnabled}
        guidesLegendEnabled={user.guidesLegendEnabled}
        theme={user.theme}
      />
      {/* Preloaded palette: opening is a state flip, data is lazy (spec 5.3). */}
      <CommandPalette zone="student" />
    </>
  );
}
