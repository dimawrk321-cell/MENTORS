/**
 * Break-glass recovery for the OWNER account (spec 11 / 12.1).
 *
 * The admin UI cannot do this: `adminResetPasswordToTemp` refuses any user whose
 * role is not `student`, and the owner is by definition the person who would
 * otherwise be locked out with nobody above them. This script is the documented
 * way back in, run from the server by whoever already holds root SSH.
 *
 * What it does:
 *   • generates a temporary password with the app's own generator;
 *   • hashes it with the app's own argon2id parameters (hashPassword), so the
 *     stored format is byte-identical to every other password in the table;
 *   • sets `must_change_password`, so the next login goes straight to «Придумай
 *     свой пароль»;
 *   • invalidates any pending self-serve reset links.
 *
 * What it deliberately does NOT do:
 *   • it does not touch any role other than `owner` — a recovery tool with a
 *     wider blast radius is a backdoor;
 *   • it does not revoke sessions (same call as the admin button: that is a
 *     separate, deliberate action);
 *   • it writes NO audit row and NO log line. The normal admin reset audits
 *     `password.reset_to_temp` because an admin is acting on someone else's
 *     account; here the account holder is acting on their own, from a shell that
 *     already has full database access, so an audit entry would record nothing
 *     the SSH access does not already imply.
 *
 * The password is printed ONCE, to stdout, and is never persisted anywhere.
 *
 * Run on the stand (see the one-liner in the walk report):
 *   pnpm exec tsx scripts/reset-owner-password.ts --email=<owner email>
 */
import { prisma } from "@/lib/db";
import { generateTempPassword } from "@/lib/utils/crypto";
import { hashPassword } from "@/lib/utils/password";

const email = process.argv
  .slice(2)
  .find((arg) => arg.startsWith("--email="))
  ?.slice("--email=".length)
  .trim()
  .toLowerCase();

async function main(): Promise<void> {
  if (!email) {
    console.error("Нужен --email=<почта владельца>.");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, status: true },
  });

  if (!user) {
    console.error(`Пользователь ${email} не найден.`);
    process.exitCode = 1;
    return;
  }
  if (user.role !== "owner") {
    // Narrow on purpose: everyone else is recoverable through the admin UI.
    console.error(`У ${email} роль «${user.role}», а не owner. Сброс не выполнен.`);
    process.exitCode = 1;
    return;
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true },
    });
    await tx.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
  });

  // The ONLY place the plaintext ever appears. Nothing else is printed with it.
  console.log("");
  console.log(`  логин:  ${user.email}`);
  console.log(`  пароль: ${tempPassword}`);
  console.log("");
  console.log("  Действует до первого входа — платформа сразу попросит сменить его.");
  console.log("");

  await prisma.$disconnect();
}

void main();
