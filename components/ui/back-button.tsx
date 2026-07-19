"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Hierarchical back button (spec 12.1/C7): navigates to the logical parent (a fixed
// href), NOT history.back(). Optional confirm intercepts the click (trainer session).
// Mobile touch target ≥44px (min-h-11); on desktop it collapses to the text height.

interface BackButtonProps {
  href: string;
  label: string;
  /** When set, click asks for confirmation before navigating (spec 12.1/C7 trainer). */
  confirmMessage?: string;
  /** Header rows pass a className without `w-fit`; standalone pages keep it. */
  className?: string;
}

const BASE =
  "text-text-3 ease-app hover:text-text-1 flex w-fit min-h-11 items-center gap-1.5 text-[13px] transition-colors duration-150 md:min-h-0";

export function BackButton({ href, label, confirmMessage, className }: BackButtonProps) {
  const router = useRouter();

  if (confirmMessage) {
    return (
      <button
        type="button"
        onClick={() => {
          if (window.confirm(confirmMessage)) router.push(href);
        }}
        className={cn(BASE, className)}
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <Link href={href} className={cn(BASE, className)}>
      <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Link>
  );
}
