"use client";

import { useCallback, useMemo, useState } from "react";

// Shared multi-select for admin bulk lists (spec 13.1/C). Holds a Set of ids;
// callers drive select-all-on-page and select-all-by-filter (the latter fetches
// the full id list from a server action and calls `replace`). Kept generic so
// questions/guides/library/students all use the identical selection semantics.

export interface RowSelection {
  selected: Set<string>;
  size: number;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Add or remove a batch (e.g. the page's ids) in one update. */
  setMany: (ids: string[], on: boolean) => void;
  /** Replace the whole selection (select-all-by-filter). */
  replace: (ids: string[]) => void;
  clear: () => void;
}

export function useRowSelection(): RowSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) for (const id of ids) next.add(id);
      else for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const replace = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(
    () => ({
      selected,
      size: selected.size,
      has: (id: string) => selected.has(id),
      toggle,
      setMany,
      replace,
      clear,
    }),
    [selected, toggle, setMany, replace, clear],
  );
}

/** Tri-state for a header "select all on page" checkbox. */
export function pageCheckState(
  selection: RowSelection,
  pageIds: string[],
): boolean | "indeterminate" {
  if (pageIds.length === 0) return false;
  const on = pageIds.filter((id) => selection.has(id)).length;
  if (on === 0) return false;
  if (on === pageIds.length) return true;
  return "indeterminate";
}
