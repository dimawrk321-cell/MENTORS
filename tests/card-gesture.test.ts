import { describe, expect, it } from "vitest";
import {
  isVerticalIntent,
  resolveSwipe,
  SCROLL_INTENT_PX,
  SWIPE_MIN_DISTANCE_PX,
  type SwipeContext,
} from "@/lib/utils/card-gesture";

// Заход «Мобильный тренажёр и тосты»: скролл длинного вопроса/эталона не должен
// превращаться в оценку. jsdom в проекте нет, поэтому решение жеста вынесено в
// чистую функцию — она и проверяется, а браузерная часть (сбор контекста)
// описана ручным сценарием в отчёте захода.

function context(patch: Partial<SwipeContext> = {}): SwipeContext {
  return {
    dx: 0,
    dy: 0,
    verticalIntent: false,
    insideScrollableX: false,
    scrolled: false,
    ...patch,
  };
}

describe("resolveSwipe — горизонталь переключает", () => {
  it("свайп влево за порогом = «не знаю»", () => {
    expect(resolveSwipe(context({ dx: -SWIPE_MIN_DISTANCE_PX }))).toBe("again");
    expect(resolveSwipe(context({ dx: -160, dy: 20 }))).toBe("again");
  });

  it("свайп вправо за порогом = «знаю»", () => {
    expect(resolveSwipe(context({ dx: SWIPE_MIN_DISTANCE_PX }))).toBe("good");
    expect(resolveSwipe(context({ dx: 200, dy: -30 }))).toBe("good");
  });

  it("короткое движение порога не берёт", () => {
    expect(resolveSwipe(context({ dx: SWIPE_MIN_DISTANCE_PX - 1 }))).toBeNull();
    expect(resolveSwipe(context({ dx: -SWIPE_MIN_DISTANCE_PX + 1 }))).toBeNull();
  });
});

describe("resolveSwipe — вертикаль принадлежит скроллу", () => {
  it("диагональ без явного перевеса горизонтали не оценивает", () => {
    // 90px вбок при 80px вниз: доминирующей оси нет — это подхват страницы.
    expect(resolveSwipe(context({ dx: 90, dy: 80 }))).toBeNull();
  });

  it("замеченное во время жеста вертикальное намерение отменяет свайп", () => {
    // Палец ушёл вниз (скролл) и вернулся вбок — конечная точка выглядит как
    // свайп, но намерение было вертикальным.
    expect(resolveSwipe(context({ dx: 140, dy: 4, verticalIntent: true }))).toBeNull();
  });

  it("любой фактический скролл за время жеста отменяет свайп", () => {
    expect(resolveSwipe(context({ dx: -140, scrolled: true }))).toBeNull();
  });

  it("вертикальный свайп больше не даёт оценку «сомневаюсь» (DECISION)", () => {
    for (const dy of [80, 200, -80, -200]) {
      expect(resolveSwipe(context({ dx: 0, dy }))).toBeNull();
    }
  });
});

describe("resolveSwipe — прокрутка блока кода не переключает карточку", () => {
  it("жест, начатый в горизонтально прокручиваемом блоке, игнорируется", () => {
    // Случай владельца: вопрос про asyncio — текст + список + блок кода.
    expect(resolveSwipe(context({ dx: -200, insideScrollableX: true }))).toBeNull();
    expect(resolveSwipe(context({ dx: 200, insideScrollableX: true }))).toBeNull();
  });
});

describe("isVerticalIntent", () => {
  it("реагирует только на заметное вертикальное движение", () => {
    expect(isVerticalIntent(0, SCROLL_INTENT_PX - 1)).toBe(false);
    expect(isVerticalIntent(0, SCROLL_INTENT_PX)).toBe(true);
    expect(isVerticalIntent(0, -SCROLL_INTENT_PX)).toBe(true);
  });

  it("горизонтальное движение вертикальным намерением не считается", () => {
    expect(isVerticalIntent(60, 20)).toBe(false);
  });
});
