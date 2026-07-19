import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { generateNumericCode, sha256Hex } from "@/lib/utils/crypto";
import { sendEmailVerificationEmail } from "@/lib/services/mail";

// Soft email verification (spec 12.1/C8). A 6-digit code (hashed, like reset tokens)
// is issued on invite activation; the student confirms it in the profile. Nothing is
// blocked — it's a quality-of-contact signal. One active code per user (issuing
// deletes prior rows), TTL 15 min, ≤5 attempts, resend cooldown 60 s.

export const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

export type IssueCodeResult =
  { ok: true } | { ok: false; code: "not_found" | "already_verified" | "cooldown" };

export type VerifyCodeResult =
  | { ok: true }
  | {
      ok: false;
      code: "not_found" | "already_verified" | "no_code" | "expired" | "too_many" | "invalid";
    };

/**
 * Issue a fresh code (spec 12.1/C8). Called post-activation (no cooldown) and on
 * resend (`enforceCooldown`). Deletes any prior code, sends the email (non-fatal),
 * and in dev (no SMTP) logs the code so it's testable without a mailbox.
 */
export async function issueEmailCode(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
  opts: { enforceCooldown?: boolean } = {},
): Promise<IssueCodeResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user) return { ok: false, code: "not_found" };
  if (user.emailVerifiedAt) return { ok: false, code: "already_verified" };

  if (opts.enforceCooldown) {
    const latest = await db.emailVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < EMAIL_CODE_RESEND_COOLDOWN_MS) {
      return { ok: false, code: "cooldown" };
    }
  }

  const code = generateNumericCode(6);
  await db.$transaction(async (tx) => {
    await tx.emailVerification.deleteMany({ where: { userId } });
    await tx.emailVerification.create({
      data: {
        userId,
        codeHash: sha256Hex(code),
        expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS),
      },
    });
  });

  await sendEmailVerificationEmail(user.email, code);
  if (!env.smtp.host) logger.info({ userId, code }, "email verification code (dev, no SMTP)");
  return { ok: true };
}

/** Resend a code with the 60 s cooldown (spec 12.1/C8). */
export async function resendEmailCode(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<IssueCodeResult> {
  return issueEmailCode(db, userId, now, { enforceCooldown: true });
}

/**
 * Verify a submitted code (spec 12.1/C8). Wrong codes burn an attempt (≤5); a match
 * sets email_verified_at and deletes the code (one-time). Expiry and the attempt cap
 * are enforced before the hash compare.
 */
export async function verifyEmailCode(
  db: PrismaClient,
  userId: string,
  code: string,
  now: Date = new Date(),
): Promise<VerifyCodeResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (!user) return { ok: false, code: "not_found" };
  if (user.emailVerifiedAt) return { ok: false, code: "already_verified" };

  const row = await db.emailVerification.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, code: "no_code" };
  if (row.expiresAt <= now) return { ok: false, code: "expired" };
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return { ok: false, code: "too_many" };

  if (sha256Hex(code) !== row.codeHash) {
    // Atomic attempt claim (stage 12.2, adversarial-фикс): a read-then-increment
    // let N concurrent wrong guesses all pass the `attempts >= MAX` check on the
    // same stale read. Increment only while attempts < MAX; count===0 means the
    // cap was already reached (concurrently) → «too_many», so ≤ MAX guesses land.
    const claim = await db.emailVerification.updateMany({
      where: { id: row.id, attempts: { lt: EMAIL_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, code: claim.count === 0 ? "too_many" : "invalid" };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: now } });
    await tx.emailVerification.deleteMany({ where: { userId } });
  });
  return { ok: true };
}
