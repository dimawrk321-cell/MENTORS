/**
 * Shared class for NATIVE form controls (`<select>`, `<input type="date">`,
 * number and time inputs) that cannot use the Input/Select components.
 *
 * Height is the point: `h-11 md:h-9` keeps a ≥44px touch target on mobile, the
 * rule input.tsx:9-10 and select.tsx:22 already implement. Six admin screens had
 * copied the class with a bare `h-9` and drifted from it — hence one export.
 * Add per-site width (`w-full`, `w-24`, `max-w-[200px]`) with cn().
 */
export const NATIVE_FIELD_CLASS =
  "rounded-control border-border text-text-1 ease-app hover:border-border-strong h-11 border bg-transparent px-3 text-[14px] transition-colors duration-150 md:h-9";
