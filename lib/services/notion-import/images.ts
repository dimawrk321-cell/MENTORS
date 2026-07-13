import type { ImageRef } from "./types";

// Image handling for the importer (spec 7.14 п.5). The export references images
// by URL-encoded relative paths; files live next to the .md. We copy them to
// public/media/import/ under ASCII, git-safe names and rewrite the markdown.
// A missing file becomes a TODO placeholder instead of a broken link.

/** Public URL prefix served from /public. */
export const IMPORT_MEDIA_URL = "/media/import";
/** Placeholder for an image whose file is absent (spec 7.14 / task wording). */
export const MISSING_IMAGE_PLACEHOLDER = "![Изображение: добавьте вручную](TODO)";

/** Basename of a possibly URL-encoded relative path, decoded. */
export function decodeImagePath(rawUrl: string): string {
  let decoded = rawUrl;
  try {
    decoded = decodeURIComponent(rawUrl);
  } catch {
    // Malformed percent-encoding — keep raw.
  }
  return decoded;
}

export function imageBasename(decodedPath: string): string {
  const parts = decodedPath.split(/[\\/]/);
  return parts[parts.length - 1] ?? decodedPath;
}

/** ASCII, git-safe filename: spaces → «-», drop anything outside [A-Za-z0-9._-]. */
export function normalizeImageName(basename: string): string {
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext =
    dot > 0
      ? basename
          .slice(dot + 1)
          .replace(/[^a-zA-Z0-9]/g, "")
          .toLowerCase()
      : "";
  const safeStem =
    stem
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase() || "image";
  return ext ? `${safeStem}.${ext}` : safeStem;
}

/**
 * Resolver injected into the content converters: keeps purity (no fs) while
 * accumulating the distinct refs to copy and guaranteeing unique target names.
 * `has` reports whether the source file is present (missing → placeholder).
 */
export interface ImageResolver {
  /** URL to substitute, or null when the file is missing. */
  resolve(rawUrl: string): { url: string } | null;
  /** Distinct references to copy, in first-seen order. */
  refs(): ImageRef[];
}

export function createImageResolver(availableBasenames: Set<string>): ImageResolver {
  const byOriginal = new Map<string, ImageRef>();
  const usedNames = new Set<string>();

  return {
    resolve(rawUrl: string) {
      const decoded = decodeImagePath(rawUrl);
      const basename = imageBasename(decoded);
      if (!availableBasenames.has(basename)) return null;

      const existing = byOriginal.get(basename);
      if (existing) return { url: `${IMPORT_MEDIA_URL}/${existing.normalizedName}` };

      let name = normalizeImageName(basename);
      if (usedNames.has(name)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let n = 2;
        while (usedNames.has(`${stem}-${n}${ext}`)) n += 1;
        name = `${stem}-${n}${ext}`;
      }
      usedNames.add(name);
      const ref: ImageRef = { originalDecodedPath: decoded, normalizedName: name };
      byOriginal.set(basename, ref);
      return { url: `${IMPORT_MEDIA_URL}/${name}` };
    },
    refs() {
      return [...byOriginal.values()];
    },
  };
}
