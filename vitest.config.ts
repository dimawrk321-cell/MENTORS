import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "pgsql/**"],
    // Stage-1 suites share one test database — files run sequentially.
    fileParallelism: false,
    globalSetup: "./tests/global-setup.ts",
    testTimeout: 30_000, // argon2id at 64MB×3 is deliberately slow
    env: {
      LOG_LEVEL: "silent",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
