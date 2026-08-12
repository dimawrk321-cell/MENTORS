import { describe, expect, it } from "vitest";
import {
  pushToast,
  toastCollapseKey,
  toastCountLabel,
  TOAST_STACK_LIMIT,
  type StackedToast,
} from "@/lib/utils/toast-stack";

// Заход «Мобильный тренажёр и тосты»: шесть «Добавлено в повторения» закрыли
// пол-экрана каталога вместе со списком под ними. Правила стека — чистые, здесь
// и проверяются (jsdom в проекте нет).

interface TestToast extends StackedToast {
  title: string;
}

let nextId = 0;

function make(title: string, options: { action?: boolean; variant?: string } = {}): TestToast {
  nextId += 1;
  return {
    id: nextId,
    count: 1,
    collapseKey: toastCollapseKey({
      title,
      variant: options.variant,
      hasAction: Boolean(options.action),
    }),
    title,
  };
}

function stack(titles: string[]): TestToast[] {
  return titles.reduce<TestToast[]>((items, title) => pushToast(items, make(title)), []);
}

describe("лимит стека", () => {
  it("одновременно живут не больше двух тостов", () => {
    const items = stack(["Первый", "Второй", "Третий", "Четвёртый"]);
    expect(items).toHaveLength(TOAST_STACK_LIMIT);
  });

  it("новые вытесняют старые, порядок сохраняется", () => {
    const items = stack(["Первый", "Второй", "Третий"]);
    expect(items.map((i) => i.title)).toEqual(["Второй", "Третий"]);
  });
});

describe("схлопывание однотипных", () => {
  it("шесть одинаковых дают один тост со счётчиком", () => {
    const items = stack(Array.from({ length: 6 }, () => "Добавлено в повторения"));
    expect(items).toHaveLength(1);
    expect(items[0]!.count).toBe(6);
    expect(toastCountLabel(items[0]!.count)).toBe("×6");
  });

  it("одиночный тост счётчика не показывает", () => {
    const items = stack(["Добавлено в повторения"]);
    expect(toastCountLabel(items[0]!.count)).toBeNull();
  });

  it("схлопнутый тост получает новый id — таймер авто-закрытия перезапускается", () => {
    const first = make("Добавлено в повторения");
    const items = pushToast(pushToast([], first), make("Добавлено в повторения"));
    expect(items[0]!.id).not.toBe(first.id);
  });

  it("повтор поднимает тост в конец очереди, не вытесняя соседа", () => {
    let items = pushToast([], make("Добавлено в повторения"));
    items = pushToast(items, make("Сохранено"));
    items = pushToast(items, make("Добавлено в повторения"));
    expect(items.map((i) => i.title)).toEqual(["Сохранено", "Добавлено в повторения"]);
    expect(items[1]!.count).toBe(2);
  });

  it("разные сообщения и разные варианты не схлопываются", () => {
    let items = pushToast([], make("Готово", { variant: "success" }));
    items = pushToast(items, make("Готово", { variant: "danger" }));
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.count === 1)).toBe(true);
  });

  it("тост с действием «Вернуть» уникален — своё действие у каждого", () => {
    let items = pushToast([], make("Блок удалён", { action: true }));
    items = pushToast(items, make("Блок удалён", { action: true }));
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.collapseKey === null)).toBe(true);
  });
});
