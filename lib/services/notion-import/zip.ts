import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { imageBasename } from "./images";

// Minimal, dependency-free ZIP reader for the optional image archive on
// /admin/import (spec 7.14: «опционально zip с картинками»). Node has no built-in
// unzip and pulling a package in for one internal tool is heavier than this
// focused reader. It walks the End-Of-Central-Directory → central directory and
// extracts only image entries (store/deflate), writing each under its basename —
// so no zip-slip traversal is possible. Encrypted/zip64/unknown entries are
// skipped, not fatal; a malformed archive yields zero images, never a throw.

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Find the End-Of-Central-Directory record (scans the last ≤64 KiB). */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** Read the central directory entries (name/method/size/local offset). */
function readCentralDirectory(buf: Buffer): CentralEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) return [];
  const total = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: CentralEntry[] = [];
  for (let i = 0; i < total; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDH_SIG) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Uncompressed bytes of one entry, or null if unreadable (encrypted/zip64/bad). */
function readEntryData(buf: Buffer, entry: CentralEntry): Buffer | null {
  const lo = entry.localOffset;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== LFH_SIG) return null;
  // zip64 / streamed-size markers we don't handle — skip rather than misread.
  if (entry.compressedSize === 0xffffffff) return null;
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  try {
    if (entry.method === 0) return Buffer.from(data); // stored
    if (entry.method === 8) return zlib.inflateRawSync(data); // deflate
    return null; // unsupported method
  } catch {
    return null;
  }
}

/**
 * Extracts image entries of a ZIP buffer into `destDir` (flat, keyed by
 * basename to match `collectImages`). Returns how many image files were written.
 */
export function extractImagesFromZip(zipBuffer: Buffer, destDir: string): { extracted: number } {
  let extracted = 0;
  let entries: CentralEntry[];
  try {
    entries = readCentralDirectory(zipBuffer);
  } catch {
    return { extracted: 0 };
  }
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of entries) {
    const base = imageBasename(entry.name);
    if (!IMAGE_RE.test(base)) continue;
    const data = readEntryData(zipBuffer, entry);
    if (!data) continue;
    try {
      fs.writeFileSync(path.join(destDir, base), data);
      extracted += 1;
    } catch {
      // Ignore a single unwritable entry; a partial image set still imports.
    }
  }
  return { extracted };
}
