import type { ReactNode } from "react";
import { StudentSidebar } from "@/components/layout/student-sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "MENTORS";

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <>
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
