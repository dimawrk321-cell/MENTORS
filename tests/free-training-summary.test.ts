import { describe, expect, it } from "vitest";
import {
  summarizeFreeTraining,
  type FreeTrainingAnswer,
  type FreeTrainingRoot,
} from "@/lib/utils/free-training-summary";

// Чистый подсчёт итога прогона. Тем же кодом считает сервер после записи карточек
// и клиент в режиме «Глазами ученика», где записи нет вовсе — поэтому расхождение
// между этими двумя итогами невозможно by construction, и проверяем мы одну функцию.

const ml: FreeTrainingRoot = { id: "root-ml", title: "Classic ML", colorIndex: 2 };
const py: FreeTrainingRoot = { id: "root-py", title: "Python", colorIndex: 5 };

function roots(pairs: [string, FreeTrainingRoot][]): Map<string, FreeTrainingRoot> {
  return new Map(pairs);
}

describe("summarizeFreeTraining", () => {
  it("считает оценки по видам", () => {
    const answers: FreeTrainingAnswer[] = [
      { questionId: "q1", grade: "good" },
      { questionId: "q2", grade: "hard" },
      { questionId: "q3", grade: "again" },
      { questionId: "q4", grade: "good" },
    ];
    const result = summarizeFreeTraining(
      answers,
      roots([
        ["q1", ml],
        ["q2", ml],
        ["q3", ml],
        ["q4", ml],
      ]),
    );
    expect(result.good).toBe(2);
    expect(result.hard).toBe(1);
    expect(result.again).toBe(1);
  });

  it("в «слабые» попадают и «не знаю», и «сомневаюсь», в порядке прогона", () => {
    const result = summarizeFreeTraining(
      [
        { questionId: "q1", grade: "hard" },
        { questionId: "q2", grade: "good" },
        { questionId: "q3", grade: "again" },
      ],
      roots([
        ["q1", ml],
        ["q2", ml],
        ["q3", ml],
      ]),
    );
    expect(result.weakQuestionIds).toEqual(["q1", "q3"]);
  });

  it("группирует по КОРНЕВОЙ категории, худшие сверху", () => {
    const result = summarizeFreeTraining(
      [
        { questionId: "q1", grade: "good" },
        { questionId: "q2", grade: "good" },
        { questionId: "q3", grade: "again" },
        { questionId: "q4", grade: "again" },
        { questionId: "q5", grade: "hard" },
      ],
      roots([
        ["q1", py],
        ["q2", ml],
        ["q3", ml],
        ["q4", ml],
        ["q5", py],
      ]),
    );
    expect(result.byCategory).toEqual([
      { categoryId: "root-ml", title: "Classic ML", colorIndex: 2, total: 3, missed: 2 },
      { categoryId: "root-py", title: "Python", colorIndex: 5, total: 2, missed: 1 },
    ]);
  });

  it("при равных промахах выше та тема, где больше вопросов", () => {
    const result = summarizeFreeTraining(
      [
        { questionId: "q1", grade: "again" },
        { questionId: "q2", grade: "good" },
        { questionId: "q3", grade: "again" },
      ],
      roots([
        ["q1", py],
        ["q2", py],
        ["q3", ml],
      ]),
    );
    expect(result.byCategory.map((row) => row.categoryId)).toEqual(["root-py", "root-ml"]);
  });

  it("исчезнувший вопрос не ломает итог: в счётчиках есть, в разборе нет", () => {
    const result = summarizeFreeTraining(
      [
        { questionId: "q1", grade: "again" },
        { questionId: "gone", grade: "again" },
      ],
      roots([["q1", ml]]),
    );
    expect(result.again).toBe(2);
    expect(result.weakQuestionIds).toEqual(["q1", "gone"]);
    expect(result.byCategory).toEqual([
      { categoryId: "root-ml", title: "Classic ML", colorIndex: 2, total: 1, missed: 1 },
    ]);
  });

  it("пустой прогон даёт нули, а не падение", () => {
    const result = summarizeFreeTraining([], roots([]));
    expect(result).toEqual({
      good: 0,
      hard: 0,
      again: 0,
      byCategory: [],
      weakQuestionIds: [],
    });
  });

  it("чистая функция: ничего не мутирует во входных данных", () => {
    const answers: FreeTrainingAnswer[] = [{ questionId: "q1", grade: "good" }];
    const snapshot = JSON.stringify(answers);
    summarizeFreeTraining(answers, roots([["q1", ml]]));
    expect(JSON.stringify(answers)).toBe(snapshot);
  });
});
