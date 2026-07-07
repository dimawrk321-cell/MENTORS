import { PrismaClient, Prisma } from "@prisma/client";

// Standard Next.js dev-mode singleton: hot reload must not leak connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Services accept either the root client or a transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;
