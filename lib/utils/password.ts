import { hash, verify } from "@node-rs/argon2";

// Spec 11: argon2id, memory 64MB, iterations 3. Parallelism 1 (single-lane,
// predictable load on a small VPS — spec does not pin it).
const ARGON2_OPTIONS = {
  memoryCost: 65536, // KiB = 64 MB
  timeCost: 3,
  parallelism: 1,
};

export const PASSWORD_MIN_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Constant-work verification target for logins with an unknown email —
 * auth errors must not reveal whether the email exists (spec 11), including
 * via response timing.
 */
export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash("dummy-password-for-timing", ARGON2_OPTIONS);
  return dummyHashPromise;
}
