import type { ReactNode } from "react";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";

/** Public auth zone (spec 8.1): centered single card, logo above. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center text-[18px] font-semibold tracking-tight">{brandName}</div>
        {children}
      </div>
    </div>
  );
}
