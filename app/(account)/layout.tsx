import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/brand-mark";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";

/**
 * Chromeless authenticated-account zone (walk 12.4/A2): the forced set-password
 * screen. Same centered single-card look as the auth zone, but for a logged-in
 * user — the guard (requirePasswordSetup) admits only pending-change accounts.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-[384px] flex-col gap-5">
        <div className="flex justify-center">
          <BrandMark brandName={brandName} tileSize={36} showLabel={false} />
        </div>
        {children}
      </div>
    </div>
  );
}
