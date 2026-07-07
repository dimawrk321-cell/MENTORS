import { createHash, randomBytes } from "node:crypto";

/** Random 256-bit token, base64url — used for sessions, invites, resets (spec 7.2/11). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable small hash for palette assignment (avatar color index 0..7). */
export function paletteIndex(seed: string, size = 8): number {
  const digest = createHash("sha256").update(seed).digest();
  return (digest[0] ?? 0) % size;
}
