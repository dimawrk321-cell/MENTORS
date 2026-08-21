import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

// Заход C.5. Послабление frame-src под Я.Диск снято, правило CSP снова одно на
// весь сайт. Здесь проверяется ФОРМА заголовков из next.config (значения, а не
// живой ответ): что послабления нет ни на одном маршруте, что общий паттерн
// перестал быть исключающим, и главное — что точечное самофреймирование
// превью студии (заход 13.6) упрощение пережило.
//
// Живые заголовки стенда/дев-сервера проверяются отдельно запросом — тест
// охраняет конфигурацию, а не транспорт.

async function rules() {
  const headers = await nextConfig.headers!();
  return headers.map((rule) => ({
    source: rule.source,
    values: Object.fromEntries(rule.headers.map((h) => [h.key, h.value])),
  }));
}

function cspOf(rule: { values: Record<string, string> }): string {
  return rule.values["Content-Security-Policy"] ?? "";
}

describe("CSP: одна политика на весь сайт", () => {
  it("ни на одном маршруте нет доменов Я.Диска во frame-src", async () => {
    for (const rule of await rules()) {
      expect(cspOf(rule)).not.toMatch(/yandex/i);
    }
  });

  it("общее правило покрывает все пути обычным паттерном, без негативного lookahead", async () => {
    const all = await rules();
    const general = all.find((r) => cspOf(r).includes("frame-ancestors 'none'"));
    expect(general?.source).toBe("/:path*");
    for (const rule of all) {
      expect(rule.source).not.toContain("(?!");
    }
  });

  it("сторонний источник во фрейме ровно один — youtube-nocookie", async () => {
    const general = (await rules()).find((r) => r.source === "/:path*")!;
    expect(cspOf(general)).toContain("frame-src 'self' https://www.youtube-nocookie.com;");
  });

  it("общий случай — ОДНО правило, а не две записи с одинаковым source", async () => {
    const all = await rules();
    expect(all.filter((r) => r.source === "/:path*")).toHaveLength(1);
    // CSP и прочие заголовки безопасности едут вместе.
    const general = all.find((r) => r.source === "/:path*")!;
    expect(general.values["X-Frame-Options"]).toBe("DENY");
    expect(cspOf(general)).not.toBe("");
  });
});

describe("CSP: превью студии по-прежнему можно фреймить со своего origin (13.6)", () => {
  it("у content-preview/guide-preview свои X-Frame-Options и frame-ancestors", async () => {
    const preview = (await rules()).find((r) => r.source.includes("content-preview"));

    expect(preview).toBeDefined();
    expect(preview!.values["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(cspOf(preview!)).toContain("frame-ancestors 'self'");
    expect(cspOf(preview!)).not.toContain("frame-ancestors 'none'");
  });

  it("правило превью стоит ПОСЛЕ общего — переопределение держится на порядке", async () => {
    const all = await rules();
    const generalAt = all.findIndex((r) => r.source === "/:path*" && cspOf(r) !== "");
    const previewAt = all.findIndex((r) => r.source.includes("content-preview"));

    expect(generalAt).toBeGreaterThanOrEqual(0);
    expect(previewAt).toBeGreaterThan(generalAt);
  });

  it("остальные маршруты остаются DENY / 'none'", async () => {
    const general = (await rules()).find((r) => r.source === "/:path*")!;
    expect(general.values["X-Frame-Options"]).toBe("DENY");
    expect(cspOf(general)).toContain("frame-ancestors 'none'");
  });
});
