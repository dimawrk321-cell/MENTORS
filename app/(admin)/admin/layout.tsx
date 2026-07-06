import type { ReactNode } from "react";
import { AdminNav } from "@/components/layout/admin-sidebar";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "MENTORS";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    // Block layout on mobile (chip row above content), flex row with sidebar on md+.
    <div className="min-h-dvh md:flex">
      <AdminNav brandName={brandName} />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>
      </main>
    </div>
  );
}
