import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards spec section 5.1: every design token must exist with the exact spec value.
const css = readFileSync(path.resolve(__dirname, "../styles/tokens.css"), "utf8");
const rootBlock = css.slice(css.indexOf(":root"), css.indexOf('[data-theme="light"]'));
const lightBlock = css.slice(css.indexOf('[data-theme="light"]'));

const darkTokens: Record<string, string> = {
  "--bg": "#0b0c0e",
  "--surface-1": "#131417",
  "--surface-2": "#1a1c20",
  "--border": "rgb(255 255 255 / 0.08)",
  "--border-strong": "rgb(255 255 255 / 0.14)",
  "--text-1": "#edeef0",
  "--text-2": "#9ba0a8",
  "--text-3": "#6b7078",
  "--accent": "#5e6ad2",
  "--accent-hover": "#6e7ade",
  "--success": "#45a26f",
  "--warning": "#c9973f",
  "--danger": "#d25353",
  "--gradient-accent": "linear-gradient(135deg, #5e6ad2, #8b5cf6)",
  "--radius-card": "14px",
  "--radius-control": "10px",
  "--radius-pill": "999px",
  "--dur-fast": "150ms",
  "--dur-base": "200ms",
  "--dur-slow": "250ms",
  "--ease": "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
};

const lightTokens: Record<string, string> = {
  "--bg": "#fafaf9",
  "--surface-1": "#ffffff",
  "--surface-2": "#ffffff",
  "--border": "rgb(0 0 0 / 0.07)",
  "--border-strong": "rgb(0 0 0 / 0.12)",
  "--text-1": "#17181a",
  "--text-2": "#5f646d",
  "--text-3": "#8a8f98",
  "--accent": "#4c57c4",
  "--accent-hover": "#4450b8",
  "--success": "#2e8b57",
  "--warning": "#b07e28",
  "--danger": "#c03e3e",
  "--shadow-surface-2": "0 1px 3px rgb(0 0 0 / 0.06)",
};

const categoryColors = [
  "#7b87e8",
  "#4fb3a9",
  "#c9973f",
  "#c77394",
  "#7fa86b",
  "#5b9bd1",
  "#9b7fd1",
  "#c87e5a",
];

describe("design tokens (spec 5.1)", () => {
  it.each(Object.entries(darkTokens))("dark: %s = %s", (name, value) => {
    expect(rootBlock).toContain(`${name}: ${value}`);
  });

  it.each(Object.entries(lightTokens))("light: %s = %s", (name, value) => {
    expect(lightBlock).toContain(`${name}: ${value}`);
  });

  it("defines all 8 category colors", () => {
    categoryColors.forEach((color, i) => {
      expect(rootBlock).toContain(`--cat-${i}: ${color}`);
    });
  });
});
