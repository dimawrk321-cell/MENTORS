import { createHash, randomBytes, randomInt } from "node:crypto";

/** Random 256-bit token, base64url — used for sessions, invites, resets (spec 7.2/11). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Uniform N-digit numeric code, zero-padded (spec 12.1/C8: email verification). */
export function generateNumericCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, "0");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Readable alphabet for admin-issued temporary passwords (walk 12.4 / spec 7.1).
 * Excludes the look-alike glyphs the spec names — `O 0 l 1` — plus capital `I`
 * (collides with `1`/`l`); lowercase `o`/`i` stay (unambiguous once `0/O/1/l/I`
 * are gone). 55 symbols; a person reads it off a screen once, then it is retired.
 */
export const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * Admin-issued temporary password (walk 12.4): 12 readable chars, each picked
 * with `randomInt` (unbiased CSPRNG, same primitive as generateNumericCode).
 * Shown once at creation/reset; only its argon2id hash is ever persisted.
 */
export function generateTempPassword(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(0, TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

/** Stable small hash for palette assignment (avatar color index 0..7). */
export function paletteIndex(seed: string, size = 8): number {
  const digest = createHash("sha256").update(seed).digest();
  return (digest[0] ?? 0) % size;
}
