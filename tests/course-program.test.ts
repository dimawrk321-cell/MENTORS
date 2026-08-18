import { describe, expect, it } from "vitest";
import { lessonKindLabel, lessonTotalMinutes } from "@/lib/utils/lesson-path";
import { applyLessonFilter } from "@/lib/utils/course-program-filter";
import type { ModuleTreeModule } from "@/components/features/module-tree";

// Страница курса по референсу v2 (заход B.5). Здесь чистая часть: арифметика
// минут, метка типа урока и фильтр «Все / Не пройдены / Видео». Раскладка
// (колонка 280px, контейнерный порог 840px, шесть ширин) проверена замером в
// браузере и описана в отчёте захода — тестами она не покрывается: jsdom в
// проекте нет.

const base = {
  readingMinutes: 8,
  textMinutes: null,
  videoMinutes: null,
  practiceMinutes: null,
  hasVideo: false,
} as const;

describe("lessonTotalMinutes", () => {
  it("текст без ручной длительности берёт оценку чтения", () => {
    expect(lessonTotalMinutes({ ...base, pathPolicy: "text_only" })).toBe(8);
  });

  it("совмещённый путь складывает видео и текст, практику прибавляет всегда", () => {
    expect(
      lessonTotalMinutes({
        ...base,
        pathPolicy: "combined",
        hasVideo: true,
        videoMinutes: 12,
        textMinutes: 6,
        practiceMinutes: 5,
      }),
    ).toBe(23);
  });

  it("«на выбор» берёт больший путь, а не сумму: занизить оценку хуже, чем завысить", () => {
    expect(
      lessonTotalMinutes({
        ...base,
        pathPolicy: "choose_one",
        hasVideo: true,
        videoMinutes: 18,
        textMinutes: 6,
      }),
    ).toBe(18);
  });

  it("видео с неизвестной длительностью в сумму не попадает", () => {
    // Поэтому на экране «~»: честнее показать заниженное число с тильдой, чем
    // выдумать длительность ролика.
    expect(lessonTotalMinutes({ ...base, pathPolicy: "combined", hasVideo: true })).toBe(8);
  });

  it("video_only без известной длительности деградирует до текста", () => {
    expect(lessonTotalMinutes({ ...base, pathPolicy: "video_only", hasVideo: true })).toBe(8);
  });
});

describe("lessonKindLabel", () => {
  it("урок без видео — текст", () => {
    expect(lessonKindLabel({ pathPolicy: "combined", hasVideo: false })).toEqual({
      label: "текст",
      isVideo: false,
    });
  });

  it("видео подсвечивается только там, где ученик его действительно увидит", () => {
    expect(lessonKindLabel({ pathPolicy: "video_only", hasVideo: true }).isVideo).toBe(true);
    expect(lessonKindLabel({ pathPolicy: "choose_one", hasVideo: true }).label).toBe(
      "видео или текст",
    );
    // Видео у урока есть, но путь — только текст: обещать видео нельзя.
    expect(lessonKindLabel({ pathPolicy: "text_only", hasVideo: true })).toEqual({
      label: "текст",
      isVideo: false,
    });
  });
});

function lesson(id: string, over: Partial<ModuleTreeModule["lessons"][number]> = {}) {
  return {
    id,
    title: id,
    readingMinutes: 5,
    pathPolicy: "combined" as const,
    textMinutes: null,
    videoMinutes: null,
    practiceMinutes: null,
    hasVideo: false,
    isOptional: false,
    unlocked: true,
    completed: false,
    current: false,
    updatedSinceCompletion: false,
    ...over,
  };
}

const modules: ModuleTreeModule[] = [
  {
    id: "m1",
    title: "Закрытый модуль",
    completedRequired: 2,
    totalRequired: 2,
    test: { passed: true, bestScore: 90, available: true, testoutAvailable: false },
    lessons: [lesson("a", { completed: true }), lesson("b", { completed: true, hasVideo: true })],
  },
  {
    id: "m2",
    title: "Текущий модуль",
    completedRequired: 0,
    totalRequired: 2,
    test: { passed: false, bestScore: null, available: false, testoutAvailable: true },
    lessons: [lesson("c", { current: true }), lesson("d", { hasVideo: true })],
  },
];

describe("фильтр программы курса", () => {
  it("«Все» отдаёт исходный список без копирования", () => {
    expect(applyLessonFilter(modules, "all")).toBe(modules);
  });

  it("«Не пройдены» убирает пройденные уроки и сданный тест", () => {
    const res = applyLessonFilter(modules, "todo");
    expect(res.map((m) => m.id)).toEqual(["m2"]);
    expect(res[0]!.lessons.map((l) => l.id)).toEqual(["c", "d"]);
    // Несданный тест — тоже незакрытый шаг модуля.
    expect(res[0]!.test).toBeDefined();
  });

  it("«Видео» оставляет только уроки с видео и убирает тесты", () => {
    const res = applyLessonFilter(modules, "video");
    expect(res.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(res.flatMap((m) => m.lessons.map((l) => l.id))).toEqual(["b", "d"]);
    expect(res.every((m) => m.test === undefined)).toBe(true);
  });

  it("модуль без единого совпадения не показывается", () => {
    const noVideo = applyLessonFilter([modules[0]!], "video");
    expect(noVideo).toHaveLength(1);
    const textOnly = applyLessonFilter(
      [{ ...modules[0]!, test: undefined, lessons: [lesson("x", { completed: true })] }],
      "video",
    );
    expect(textOnly).toHaveLength(0);
  });

  it("модуль остаётся ради несданного теста, даже если уроков после фильтра нет", () => {
    const onlyTest = applyLessonFilter(
      [{ ...modules[1]!, lessons: [lesson("y", { completed: true })] }],
      "todo",
    );
    expect(onlyTest).toHaveLength(1);
    expect(onlyTest[0]!.lessons).toHaveLength(0);
    expect(onlyTest[0]!.test).toBeDefined();
  });
});
