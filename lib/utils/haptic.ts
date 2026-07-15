// Client-only tactile feedback for the three rituals (spec 5.4): 10ms buzz,
// disabled under prefers-reduced-motion. No-op where the API is unavailable.
export function haptic(durationMs = 10): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  navigator.vibrate(durationMs);
}
