import type { ReactNode } from "react";
import { StudentSidebar } from "@/components/layout/student-sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ImpersonationBanner } from "@/components/features/impersonation-banner";
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
        <StudentSidebar brandName={brandName} />
        {/* pb-20 keeps content clear of the fixed bottom nav on mobile. */}
        <main className="flex-1 pb-20 md:pb-0">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
        </main>
      </div>
      <BottomNav />
    </>
  );
}
