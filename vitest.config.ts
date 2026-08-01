import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    // `.claude/**` holds the CLI's transient git worktrees (their own repo copy,
    // no generated Prisma client) — the project test runner must not scan them.
    exclude: ["node_modules/**", ".next/**", "pgsql/**", ".claude/**"],
    // Stage-1 suites share one test database — files run sequentially.
    fileParallelism: false,
    globalSetup: "./tests/global-setup.ts",
    testTimeout: 30_000, // argon2id at 64MB×3 is deliberately slow
    env: {
      LOG_LEVEL: "silent",
    },
  },
  // Route-guard tests (course-chain-routes) call RSC page functions directly;
  // tsconfig keeps jsx:"preserve" for Next, so esbuild needs the runtime here.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      { find: /^.*\.css$/, replacement: path.resolve(__dirname, "tests/helpers/style-stub.ts") },
      { find: /^@\//, replacement: path.resolve(__dirname, ".").replace(/\\/g, "/") + "/" },
    ],
  },
});
