import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as viewer from "@/components/features/recording-viewer";

// Заход C.5. У просмотра записи остаётся один путь — «Открыть запись» в новой
// вкладке. Ветка iframe-плеера с водяным знаком поверх снята: встраивание
// запрещает сам Я.Диск, и за всё время ни одна запись её не использовала.
//
// jsdom в проекте нет: рендер статический — проверяется разметка первого кадра.

vi.mock("@/lib/actions/library", () => ({
  openRecordingAction: async () => ({ ok: true, data: { url: "https://disk.yandex.ru/i/x" } }),
}));

describe("просмотр записи: единственный путь", () => {
  it("«Открыть запись» ведёт на ссылку записи в новой вкладке", () => {
    const html = renderToStaticMarkup(
      <viewer.RecordingOpenLink recordingId="r1" url="https://disk.yandex.ru/d/Nc4lINkxq013Vw" />,
    );

    expect(html).toContain("Открыть запись");
    expect(html).toContain('href="https://disk.yandex.ru/d/Nc4lINkxq013Vw"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });

  it("ветки встраивания больше нет — компонент не экспортируется", () => {
    expect(Object.keys(viewer)).not.toContain("RecordingEmbed");
    expect(Object.keys(viewer)).toContain("RecordingOpenLink");
  });

  it("в разметке просмотра нет iframe", () => {
    const html = renderToStaticMarkup(
      <viewer.RecordingOpenLink recordingId="r1" url="https://disk.yandex.ru/i/x" />,
    );
    expect(html).not.toContain("<iframe");
  });
});
