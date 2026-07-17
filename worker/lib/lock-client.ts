import { PrismaClient } from "@prisma/client";

// Dedicated single-connection Prisma client for advisory locks (spec 7.15).
// Session-level advisory locks must be taken and released on the SAME connection;
// connection_limit=1 guarantees one session. Memoized per process (worker and the
// /api/cron route each get one) so lock/unlock always share a connection, while a
// separate process (the other trigger path) is a distinct session that the lock
// correctly arbitrates against.

const globalForLock = globalThis as unknown as { lockClient?: PrismaClient };

function lockClientUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required for advisory-lock client");
  const url = new URL(raw);
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}

export function getLockClient(): PrismaClient {
  if (!globalForLock.lockClient) {
    globalForLock.lockClient = new PrismaClient({ datasourceUrl: lockClientUrl() });
  }
  return globalForLock.lockClient;
}
