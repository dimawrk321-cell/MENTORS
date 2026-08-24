import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("favicon PRIME", () => {
  it("публикует только брендовый P и не возвращает устаревший M-источник", () => {
    const root = process.cwd();
    const svg = readFileSync(join(root, "app", "icon.svg"), "utf8");

    expect(existsSync(join(root, "app", "favicon.ico"))).toBe(false);
    expect(svg).toContain("PRIME «P» monogram");
    expect(svg).toContain(
      'd="M17 17 L47 17 L47 37 L25 37 L25 47 L17 47 Z M25 24 L40 24 L40 30 L25 30 Z"',
    );
  });
});
