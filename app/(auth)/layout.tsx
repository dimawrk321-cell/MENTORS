import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/brand-mark";

// Spec 0.5: brand name only from env, never hardcoded.
const brandName = process.env.BRAND_NAME ?? "PRIME";

/** Public auth zone (spec 8.1): centered single card under the brand mark.
 *  Design handoff: 36px gradient tile centered above a 384px column; each page
 *  renders its own title between the mark and its card. */
export default function AuthLayout({ children }: { children: ReactNode }) {
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
