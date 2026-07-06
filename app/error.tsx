"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

// Spec 15: friendly wording, no error codes or stacktraces shown to the user.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={TriangleAlert}
        title="Что-то пошло не так"
        description="Попробуй ещё раз"
        action={<Button onClick={reset}>Повторить</Button>}
      />
    </div>
  );
}
