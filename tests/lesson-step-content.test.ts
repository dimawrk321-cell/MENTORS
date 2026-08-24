import { describe, expect, it } from "vitest";
import { lessonStepMarkdownForDisplay } from "@/lib/utils/lesson-step-content";

describe("подготовка Markdown шага к показу", () => {
  it("скрывает только дублирующий технический заголовок в начале", () => {
    const markdown =
      "## **Название урока: Знакомство с PyTorch**\n\n### Введение\n\nОсновной текст";

    expect(lessonStepMarkdownForDisplay(markdown)).toBe("### Введение\n\nОсновной текст");
  });

  it("не меняет обычный заголовок и упоминание внутри материала", () => {
    const markdown = "## Знакомство с PyTorch\n\nНазвание урока: это поле можно увидеть в примере.";

    expect(lessonStepMarkdownForDisplay(markdown)).toBe(markdown);
  });
});
