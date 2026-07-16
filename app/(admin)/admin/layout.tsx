import type { ReactNode } from "react";
import { AdminNav } from "@/components/layout/admin-sidebar";
import { CommandPalette } from "@/components/features/command-palette";
import { requireAdminZone } from "@/lib/auth/guards";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "MENTORS";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Layout guard (spec 3): mentor and above; sections are filtered by role in the nav.
  const { user } = await requireAdminZone();

  return (
    // Block layout on mobile (chip row above content), flex row with sidebar on md+.
    <div className="min-h-dvh md:flex">
      <AdminNav
        brandName={brandName}
        role={user.role}
        isInterviewer={user.isInterviewer}
        userName={user.name}
      />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
      {/* Palette opens in the admin zone too, searching the same four types (spec 7.11). */}
      <CommandPalette zone="admin" />
    </div>
  );
}
