"use client";

// Spec 15: route-level error.tsx per zone group; the focused zone (session/test/
// onboarding) keeps its own boundary now that it no longer inherits (student)/error.
export { ZoneError as default } from "@/components/layout/zone-error";
