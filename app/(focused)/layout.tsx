import type { ReactNode } from "react";
import { requireStudentZone } from "@/lib/auth/guards";
import { ImpersonationBanner } from "@/components/features/impersonation-banner";
import { OfflineBanner } from "@/components/features/offline-banner";
import { ThemeToggleIcon } from "@/components/features/theme-toggle";

// Focused full-screen zone (spec 7.6 / 8.2 / 8.3, design handoff): the SRS session,
// module test and onboarding escape the sidebar + bottom-nav shell so the student
// stays on one task. A single radial-gradient backdrop (protos «Тест»/«Онбординг»)
// carries the mood; the shared top bar holds only the theme toggle — each page
// keeps its own in-content affordances (session counter + «Закончить», test exit +
// threshold badge, onboarding progress dots).
//
// GUARD: { onboarding: true } disables ONLY the empty-name → /onboarding redirect,
// which would otherwise infinite-loop the onboarding page. It does NOT weaken auth:
// role, password and access-expiry are still enforced here, and each page re-runs
// its own guard — the session/test pages call the plain requireStudentZone() (which
// re-enforces the name gate and bounces a nameless student to /onboarding), while
// the onboarding page passes { onboarding: true } itself. getAuth is cache()-memoized,
// so layout + page share one DB hit.
export default async function FocusedLayout({ children }: { children: ReactNode }) {
  const { user, impersonated } = await requireStudentZone({ onboarding: true });

  return (
    <>
      <OfflineBanner />
      {impersonated && <ImpersonationBanner studentName={user.name} />}
      <div className="relative flex min-h-dvh flex-col">
        {/* Radial-gradient backdrop (protos «Онбординг» l.43 / «Тест» l.43): accent
            top-centre + violet bottom-right, non-interactive. */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0"
          style={{
            backgroundImage:
              "radial-gradient(880px 420px at 50% -10%, color-mix(in srgb, var(--accent) 15%, transparent), transparent 70%), radial-gradient(600px 300px at 90% 110%, color-mix(in srgb, var(--violet) 9%, transparent), transparent 70%)",
          }}
        />
        <header className="relative z-10 flex items-center justify-end px-4 py-3 md:px-6">
          <ThemeToggleIcon initialTheme={user.theme} />
        </header>
        <main className="relative z-10 w-full flex-1 px-4 pb-16 md:px-6">{children}</main>
      </div>
    </>
  );
}
