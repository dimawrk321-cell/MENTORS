import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { jobLockKey, withAdvisoryLock } from "@/worker/lib/advisory-lock";
import { testDatabaseUrl } from "./helpers/db-url";

// Advisory lock под параллельным запуском (spec 7.15 DoD). Two single-connection
// clients simulate two workers; only one may hold a named lock at a time.

function singleConnectionClient(): PrismaClient {
  const url = new URL(testDatabaseUrl());
  url.searchParams.set("connection_limit", "1");
  return new PrismaClient({ datasourceUrl: url.toString() });
}

const a = singleConnectionClient();
const b = singleConnectionClient();

afterAll(async () => {
  await Promise.allSettled([a.$disconnect(), b.$disconnect()]);
});

describe("withAdvisoryLock", () => {
  it("jobLockKey детерминирован и различает имена", () => {
    expect(jobLockKey("digest")).toBe(jobLockKey("digest"));
    expect(jobLockKey("digest")).not.toBe(jobLockKey("streakProcess"));
  });

  it("второй запуск под удержанным локом пропускается", async () => {
    let ran = 0;
    const outcome = await withAdvisoryLock(a, "concurrent-job", async () => {
      ran += 1;
      // While A holds the lock, B (separate session) cannot acquire the same key.
      const bOutcome = await withAdvisoryLock(b, "concurrent-job", async () => {
        ran += 1;
        return "b";
      });
      expect(bOutcome.ran).toBe(false);
      return "a";
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.result).toBe("a");
    expect(ran).toBe(1); // only A's body ran
  });

  it("после освобождения лок берётся снова", async () => {
    const first = await withAdvisoryLock(a, "released-job", async () => "x");
    expect(first.ran).toBe(true);
    const second = await withAdvisoryLock(b, "released-job", async () => "y");
    expect(second.ran).toBe(true);
    expect(second.result).toBe("y");
  });

  it("разные ключи не конфликтуют", async () => {
    const outcome = await withAdvisoryLock(a, "job-A", async () => {
      const inner = await withAdvisoryLock(b, "job-B", async () => "B");
      return inner.ran;
    });
    expect(outcome.result).toBe(true);
  });
});
