import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyGoal } from "@/components/features/daily-goal";
import { XpExplainer } from "@/components/features/xp-explainer";
import { DEFAULT_XP_MAP } from "@/lib/services/xp";

// Заход B.2, блок 1. Что охраняет файл: ТЕКСТ и ЧИСЛА, которые видит ученик, —
// именно они были жалобой («непонятно, что сделать, чтобы день засчитался»).
// jsdom в проекте нет: компоненты рендерятся в статическую разметку, поэтому
// здесь нет ни раскладки, ни тем — их проверяют в браузере.

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("блок дневной цели", () => {
  it("называет числа: набрано, цель, остаток", () => {
    const html = render(
      <DailyGoal
        todayXp={25}
        goal={60}
        dayKey="2026-08-16"
        todayCounted={false}
        xpMap={DEFAULT_XP_MAP}
      />,
    );
    expect(html).toContain("25");
    expect(html).toContain("60");
    expect(html).toContain("Осталось");
    expect(html).toContain("35");
  });

  it("главное объяснение: день засчитывает действие, а не закрытая цель", () => {
    const open = render(
      <DailyGoal todayXp={0} goal={60} dayKey="d" todayCounted={false} xpMap={DEFAULT_XP_MAP} />,
    );
    expect(open).toContain("День в серии засчитает любое учебное действие");

    const counted = render(
      <DailyGoal todayXp={5} goal={60} dayKey="d" todayCounted xpMap={DEFAULT_XP_MAP} />,
    );
    expect(counted).toContain("День в серии уже засчитан");
  });

  it("подсказки «чем добрать» берут значения из карты XP, а не из вёрстки", () => {
    const custom = { ...DEFAULT_XP_MAP, "lesson.completed": 42 };
    const html = render(
      <DailyGoal todayXp={0} goal={60} dayKey="d" todayCounted={false} xpMap={custom} />,
    );
    expect(html).toContain("+42");
    expect(html).not.toContain("+20");
  });

  it("закрытая цель не зовёт добирать", () => {
    const html = render(
      <DailyGoal todayXp={60} goal={60} dayKey="d" todayCounted xpMap={DEFAULT_XP_MAP} />,
    );
    expect(html).toContain("Цель на сегодня закрыта");
    expect(html).not.toContain("Осталось");
  });
});

describe("справка «XP, цель и серия»", () => {
  it("перечисляет, что засчитывает день, и таблицу начислений из настроек", () => {
    const custom = { ...DEFAULT_XP_MAP, "queue.completed": 77 };
    const html = render(<XpExplainer xpMap={custom} goal={120} />);
    expect(html).toContain("завершил урок");
    expect(html).toContain("закрыл очередь повторений");
    expect(html).toContain("+77");
    expect(html).toContain("120");
    // Прямым текстом: цель набирать не обязательно.
    expect(html).toContain("не нужно");
    // Якорь для ссылки из блока дневной цели.
    expect(html).toContain('id="xp"');
  });
});
