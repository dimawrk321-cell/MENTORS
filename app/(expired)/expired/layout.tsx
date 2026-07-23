import type { ReactNode } from "react";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";

// DECISION: /expired lives in its own route group (spec 4 lists it under
// (student)): the student layout unconditionally redirects expired accounts to
// /expired, so the screen itself must not render inside that layout — and the
// soft-locked state deliberately has no navigation chrome (spec 7.1.5).
export default function ExpiredLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-border flex h-14 items-center border-b px-4 md:px-8">
        <span className="text-[15px] font-semibold tracking-tight">{brandName}</span>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-10 md:px-8 md:py-16">{children}</main>
    </div>
  );
}
