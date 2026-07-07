"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export interface ZoneErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route-level error boundary body (spec 15): rendered inside the zone shell so
 * the user keeps navigation. Friendly wording, no codes or stacktraces.
 */
export function ZoneError({ error, reset }: ZoneErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex items-center justify-center py-16">
      <EmptyState
        icon={TriangleAlert}
        title="Что-то пошло не так"
        description="Попробуй ещё раз"
        action={<Button onClick={reset}>Повторить</Button>}
      />
    </div>
  );
}
