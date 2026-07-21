import { describe, it, expect } from "vitest";
import { visit } from "unist-util-visit";
import type { Element } from "hast";
import { renderLessonHast } from "@/lib/utils/markdown";

// Walk 12.3 P3c: a content link whose visible text is the URL itself becomes a
// <material-link> card element; a link with a human label stays a prose <a>.

async function tags(markdown: string): Promise<{ materialUrls: string[]; anchors: string[] }> {
  const { hast } = await renderLessonHast(markdown);
  const materialUrls: string[] = [];
  const anchors: string[] = [];
  visit(hast, "element", (el: Element) => {
    if (el.tagName === "material-link") materialUrls.push(String(el.properties?.url ?? ""));
    if (el.tagName === "a") anchors.push(String(el.properties?.href ?? ""));
  });
  return { materialUrls, anchors };
}

describe("material link detection (P3c)", () => {
  it("retags a bare-URL link as a material card", async () => {
    const { materialUrls, anchors } = await tags("[https://habr.com/ru/x](https://habr.com/ru/x)");
    expect(materialUrls).toEqual(["https://habr.com/ru/x"]);
    expect(anchors).toEqual([]);
  });

  it("keeps a human-labelled link as prose", async () => {
    const { materialUrls, anchors } = await tags(
      "Смотри [статью на Хабре](https://habr.com/ru/x).",
    );
    expect(materialUrls).toEqual([]);
    expect(anchors).toEqual(["https://habr.com/ru/x"]);
  });

  it("treats a GFM autolinked bare URL as a material card", async () => {
    const { materialUrls } = await tags("https://arxiv.org/abs/1706.03762");
    expect(materialUrls).toEqual(["https://arxiv.org/abs/1706.03762"]);
  });

  it("drops a leading 🔗 emoji before the card", async () => {
    const { hast } = await renderLessonHast("🔗 [https://x.com/a](https://x.com/a)");
    let text = "";
    visit(hast, "text", (t: { value: string }) => {
      text += t.value;
    });
    expect(text).not.toContain("🔗");
  });

  it("leaves internal links alone", async () => {
    const { materialUrls, anchors } = await tags("[/library/42](/library/42)");
    expect(materialUrls).toEqual([]);
    expect(anchors).toEqual(["/library/42"]);
  });
});
