"use client";

import { Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// Per-widget error boundary (spec 12.1/A1): a failing aggregate must not take down
// the whole /admin/analytics page. Each widget is wrapped in <WidgetBoundary> +
// <Suspense>; a throw in one widget renders a local «Не удалось загрузить · Повторить»
// fallback while its neighbours keep working. «Повторить» re-runs the server render
// (router.refresh) — errors are never cached (unstable_cache stores only resolved
// values), so a transient failure recovers on retry.

function RetryFallback({ onReset }: { onReset: () => void }) {
  const router = useRouter();
  return (
    <div className="text-text-3 flex flex-col items-center gap-2.5 py-8 text-center text-[13px]">
      <span>Не удалось загрузить</span>
      <button
        type="button"
        onClick={() => {
          onReset();
          router.refresh();
        }}
        className="text-accent hover:text-accent-hover ease-app inline-flex items-center gap-1.5 text-[13px] transition-colors duration-150"
      >
        <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />
        Повторить
      </button>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class WidgetBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  reset = () => this.setState({ hasError: false });

  override render() {
    if (this.state.hasError) return <RetryFallback onReset={this.reset} />;
    return this.props.children;
  }
}

/** Suspense fallback for an analytics widget body — a few shimmer bars. */
export function WidgetSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-3 w-36 shrink-0 sm:w-48" />
          <Skeleton className="h-2 flex-1 rounded-full" />
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}
