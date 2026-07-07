"use client";

import { ZoneError, type ZoneErrorProps } from "@/components/layout/zone-error";

export default function AuthError(props: ZoneErrorProps) {
  return <ZoneError {...props} />;
}
