import { describe, it, expect } from "vitest";
import { applySnippet } from "@/lib/utils/editor-insert";

// D5 (spec 13.1): directive/formula insert wraps the selection instead of
// discarding it; the wrapped body is re-selected.

const CALLOUT = { snippet: '\n:::callout{type="tip"}\n%s\n:::\n', placeholder: "Текст совета." };
const FORMULA = { snippet: "$%s$", placeholder: "" };
const TABLE = { snippet: "\n| A | B |\n", placeholder: "" };

describe("applySnippet (spec 13.1/D5)", () => {
  it("wraps the current selection inside the directive body", () => {
    const content = "до СЮДА после";
    const start = 3; // «СЮДА»
    const end = 7;
    const res = applySnippet(content, start, end, CALLOUT);
    expect(res.content).toBe('до \n:::callout{type="tip"}\nСЮДА\n:::\n после');
    // The wrapped selection is re-selected.
    expect(res.content.slice(res.selectionStart, res.selectionEnd)).toBe("СЮДА");
  });

  it("uses the placeholder and selects it when nothing is selected", () => {
    const res = applySnippet("", 0, 0, CALLOUT);
    expect(res.content).toContain("Текст совета.");
    expect(res.content.slice(res.selectionStart, res.selectionEnd)).toBe("Текст совета.");
  });

  it("Формула inserts inline $…$ with the caret between the dollars (no selection)", () => {
    const res = applySnippet("ab", 1, 1, FORMULA);
    expect(res.content).toBe("a$$b");
    // Empty body → caret sits between the two dollars.
    expect(res.selectionStart).toBe(2);
    expect(res.selectionEnd).toBe(2);
  });

  it("Формула wraps a selection as $selection$", () => {
    const res = applySnippet("a x b", 2, 3, FORMULA);
    expect(res.content).toBe("a $x$ b");
    expect(res.content.slice(res.selectionStart, res.selectionEnd)).toBe("x");
  });

  it("a snippet without %s never deletes the selection (inserts after it)", () => {
    const content = "keep me";
    const res = applySnippet(content, 0, 4, TABLE); // «keep» selected
    expect(res.content.startsWith("keep")).toBe(true); // selection preserved
    expect(res.content).toContain("| A | B |");
  });
});
