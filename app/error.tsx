"use client";

import { ZoneError, type ZoneErrorProps } from "@/components/layout/zone-error";

// Spec 15: global boundary — full-height version of the shared error body.
export default function ErrorPage(props: ZoneErrorProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <ZoneError {...props} />
    </div>
  );
}
