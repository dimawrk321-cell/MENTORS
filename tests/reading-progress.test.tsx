import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadingChapterHeader } from "@/components/features/reading-chapter-header";

describe("прогресс составного урока", () => {
  it("делит сегмент текущего урока на его шаги", () => {
    const html = renderToStaticMarkup(
      <ReadingChapterHeader
        kicker="Урок"
        index={2}
        total={4}
        segments={["done", "current", "todo", "locked"]}
        currentSegments={["done", "done", "current", "locked"]}
      />,
    );

    expect(html).toContain('aria-label="Урок 2 из 4"');
    expect(html).toContain('data-expanded-progress-segment="true"');
    expect(html.match(/data-step-progress-segment=/g)).toHaveLength(4);
    expect(html).toContain('data-step-progress-segment="current"');
  });
});
