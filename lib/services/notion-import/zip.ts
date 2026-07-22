import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { imageBasename } from "./images";

// Minimal, dependency-free ZIP reader for the optional image archive on
// /admin/import (spec 7.14: «опционально zip с картинками»). Node has no built-in
// unzip and pulling a package in for one internal tool is heavier than this
// focused reader. It walks the End-Of-Central-Directory → central directory and
// extracts only image entries (store/deflate), writing each under its BASENAME —
// so no zip-slip traversal is possible. Hardened against corrupt/hostile archives:
// out-of-bounds offsets, zip64/unknown methods and per-entry decompression bombs
// are skipped (never fatal, never OOM); exceeding the total uncompressed budget is
// a HARD, human-readable failure so a bomb can never fill the disk.

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
// 13.2 audit: SVG excluded — an imported .svg lands in public/media and would
// execute inline <script> on direct navigation (stored XSS). Notion screenshots
// are always rasterized, so dropping svg loses nothing.
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

/** Anti-bomb budgets (spec 7.14 hardening). Overridable in tests. */
export const ZIP_MAX_ENTRY_UNCOMPRESSED = 30 * 1024 * 1024; // 30 MB per image
export const ZIP_MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024; // 200 MB across the archive
export const ZIP_MAX_ENTRIES = 5000;

/** Raised when an archive would inflate past the total budget — surfaced to the user. */
export class ImportZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportZipError";
  }
}

/** Find the End-Of-Central-Directory record (scans the last ≤64 KiB). */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (i >= 0 && buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

/** Read the central directory entries (name/method/sizes/local offset). */
function readCentralDirectory(buf: Buffer): CentralEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0 || eocd + 20 > buf.length) return [];
  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  for (let i = 0; i < total; i += 1) {
    if (offset < 0 || offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDH_SIG) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    if (offset + 46 + nameLen > buf.length) break;
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Uncompressed bytes of one entry, or null if unreadable/oversized/hostile. */
function readEntryData(buf: Buffer, entry: CentralEntry, maxEntryBytes: number): Buffer | null {
  const lo = entry.localOffset;
  if (lo < 0 || lo + 30 > buf.length || buf.readUInt32LE(lo) !== LFH_SIG) return null;
  // zip64 / streamed-size markers we don't handle — skip rather than misread.
  if (entry.compressedSize === 0xffffffff || entry.uncompressedSize === 0xffffffff) return null;
  // Declared to inflate past the per-entry budget → skip (never allocate it).
  if (entry.uncompressedSize > maxEntryBytes) return null;
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  if (dataStart + entry.compressedSize > buf.length) return null; // out-of-bounds guard
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  try {
    if (entry.method === 0) {
      // Stored: uncompressed == compressed, bounded by the archive itself.
      return data.length <= maxEntryBytes ? Buffer.from(data) : null;
    }
    if (entry.method === 8) {
      // maxOutputLength makes a bomb throw (caught → skip) instead of inflating.
      return zlib.inflateRawSync(data, { maxOutputLength: maxEntryBytes });
    }
    return null; // unsupported method
  } catch {
    return null;
  }
}

export interface ZipExtractLimits {
  maxEntryBytes?: number;
  maxTotalBytes?: number;
  maxEntries?: number;
}

/**
 * Extracts image entries of a ZIP buffer into `destDir` (flat, keyed by basename
 * to match `collectImages`). Returns how many image files were written. Corrupt
 * or per-entry-oversized entries are skipped; exceeding the TOTAL uncompressed
 * budget throws ImportZipError (the caller cleans the temp dir and fails the run).
 */
export function extractImagesFromZip(
  zipBuffer: Buffer,
  destDir: string,
  limits: ZipExtractLimits = {},
): { extracted: number } {
  const maxEntryBytes = limits.maxEntryBytes ?? ZIP_MAX_ENTRY_UNCOMPRESSED;
  const maxTotalBytes = limits.maxTotalBytes ?? ZIP_MAX_TOTAL_UNCOMPRESSED;
  const maxEntries = limits.maxEntries ?? ZIP_MAX_ENTRIES;

  let entries: CentralEntry[];
  try {
    entries = readCentralDirectory(zipBuffer);
  } catch {
    return { extracted: 0 };
  }
  fs.mkdirSync(destDir, { recursive: true });

  let extracted = 0;
  let totalBytes = 0;
  for (const entry of entries) {
    if (extracted >= maxEntries) break;
    const base = imageBasename(entry.name);
    if (!IMAGE_RE.test(base)) continue;
    const data = readEntryData(zipBuffer, entry, maxEntryBytes);
    if (!data) continue;
    if (totalBytes + data.length > maxTotalBytes) {
      throw new ImportZipError(
        "Архив распаковывается в слишком большой объём (лимит 200 МБ) — уменьши набор картинок",
      );
    }
    try {
      // base strips any directory component → writes stay inside destDir (no zip-slip).
      fs.writeFileSync(path.join(destDir, base), data);
      totalBytes += data.length;
      extracted += 1;
    } catch {
      // Ignore a single unwritable entry; a partial image set still imports.
    }
  }
  return { extracted };
}
