import { beforeEach, describe, expect, it } from "vitest";
import {
  addSrsCardManually,
  getNextReviewDate,
  getSrsQueue,
  reviewSrsCard,
  SRS_NEW_PER_DAY,
} from "@/lib/services/srs";
import { addDays, dateOnlyUtc } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Обязательный набор этапа 4: дневная очередь (spec 7.6) — сортировка
// просроченных, лимит 20 новых, границы суток в таймзоне пользователя.

const NOW = new Date("2026-07-08T12:00:00.000Z"); // Москва: 8 июля, 15:00
const TODAY = dateOnlyUtc("2026-07-08");

beforeEach(async () => {
  await resetDb();
});

async function makeStudent(email = "student@test.local", timezone = "Europe/Moscow") {
  return createTestUser({ email, passwordHash: "unused", timezone });
}

async function makeQuestions(count: number): Promise<string[]> {
  const category = await testDb.questionCategory.create({
    data: { title: "Classic ML", slug: "classic-ml", colorIndex: 0, order: 0 },
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const question = await testDb.question.create({
      data: {
        type: "open",
        categoryId: category.id,
        textMd: `Вопрос ${i + 1}`,
        answerMd: "Эталон",
        status: "published",
        difficulty: 1,
      },
    });
    ids.push(question.id);
  }
  return ids;
}

async function makeCard(
  userId: string,
  questionId: string,
  data?: Partial<{
    nextReviewAt: Date;
    reviewsCount: number;
    step: number;
    suspended: boolean;
  }>,
) {
  return testDb.srsCard.create({
    data: {
      userId,
      questionId,
      addedFrom: "manual",
      nextReviewAt: data?.nextReviewAt ?? TODAY,
      reviewsCount: data?.reviewsCount ?? 0,
      step: data?.step ?? 0,
      suspended: data?.suspended ?? false,
    },
  });
}

describe("выборка дня (spec 7.6)", () => {
  it("просроченные раньше: сортировка по next_review_at asc; suspended не попадают", async () => {
    const user = await makeStudent();
    const [q1, q2, q3, q4, q5] = await makeQuestions(5);

    const today = await makeCard(user.id, q1!, { nextReviewAt: TODAY, reviewsCount: 1 });
    const overdue5 = await makeCard(user.id, q2!, {
      nextReviewAt: dateOnlyUtc("2026-07-05"),
      reviewsCount: 1,
    });
    const overdue7 = await makeCard(user.id, q3!, {
      nextReviewAt: dateOnlyUtc("2026-07-07"),
      reviewsCount: 1,
    });
    await makeCard(user.id, q4!, { nextReviewAt: addDays(TODAY, 1), reviewsCount: 1 }); // завтра
    await makeCard(user.id, q5!, { nextReviewAt: TODAY, reviewsCount: 1, suspended: true });

    const queue = await getSrsQueue(testDb, { userId: user.id, now: NOW });
    expect(queue.cards.map((card) => card.id)).toEqual([overdue5.id, overdue7.id, today.id]);
    expect(queue.total).toBe(3);
  });

  it("новых в выборке не больше 20; уже отвеченные карточки лимиту не подчиняются", async () => {
    const user = await makeStudent();
    const questionIds = await makeQuestions(30);

    // 25 новых (reviews_count=0) + 5 отвеченных, все due сегодня.
    for (const [index, questionId] of questionIds.entries()) {
      await makeCard(user.id, questionId, { reviewsCount: index < 25 ? 0 : 1 });
    }

    const queue = await getSrsQueue(testDb, { userId: user.id, now: NOW });
    expect(queue.total).toBe(SRS_NEW_PER_DAY + 5);
    const newInQueue = queue.cards.filter((card) => card.reviewsCount === 0);
    expect(newInQueue).toHaveLength(SRS_NEW_PER_DAY);
    // Лишние новые не сдвигаются в БД — их next_review_at остался сегодняшним.
    expect(
      await testDb.srsCard.count({
        where: { userId: user.id, reviewsCount: 0, nextReviewAt: TODAY },
      }),
    ).toBe(25);
  });

  it("новые, отвеченные сегодня, съедают дневной лимит — вторая порция его не обнуляет", async () => {
    const user = await makeStudent();
    const questionIds = await makeQuestions(25);
    for (const questionId of questionIds) {
      await makeCard(user.id, questionId);
    }

    const first = await getSrsQueue(testDb, { userId: user.id, now: NOW });
    expect(first.total).toBe(SRS_NEW_PER_DAY);

    // Отвечаем три новых карточки — они уходят из «сегодня».
    for (const card of first.cards.slice(0, 3)) {
      const result = await reviewSrsCard(testDb, {
        userId: user.id,
        cardId: card.id,
        grade: "good",
        now: NOW,
      });
      expect(result.ok).toBe(true);
    }

    // Лимит дня: 20 − 3 отвеченных = 17, а не свежие 20 из оставшихся 22 новых.
    const second = await getSrsQueue(testDb, { userId: user.id, now: NOW });
    expect(second.total).toBe(SRS_NEW_PER_DAY - 3);
  });

  it("оценка времени: count × 25 сек, округление вверх до минут", async () => {
    const user = await makeStudent();
    const questionIds = await makeQuestions(14);
    for (const questionId of questionIds) {
      await makeCard(user.id, questionId, { reviewsCount: 1 });
    }
    const queue = await getSrsQueue(testDb, { userId: user.id, now: NOW });
    expect(queue.total).toBe(14);
    expect(queue.estimateMinutes).toBe(6); // 350 сек → 6 мин
  });

  it("карточка снятого с публикации вопроса выпадает из очереди", async () => {
    const user = await makeStudent();
    const [live, draft] = await makeQuestions(2);
    await makeCard(user.id, live!, { reviewsCount: 1 });
    await makeCard(user.id, draft!, { reviewsCount: 1 });
    await testDb.question.update({ where: { id: draft! }, data: { status: "draft" } });

    const queue = await getSrsQueue(testDb, { userId: user.id, now: NOW });
    expect(queue.cards.map((card) => card.questionId)).toEqual([live]);
  });
});

describe("getNextReviewDate: вытеснение новых лимитом (spec 7.6)", () => {
  it("новые сверх лимита показываются завтра — пустая очередь ведёт на завтра", async () => {
    const user = await makeStudent();
    // 21 новая due-сегодня: 20 попадут в выборку, 1 вытеснена лимитом.
    const questionIds = await makeQuestions(SRS_NEW_PER_DAY + 1);
    for (const questionId of questionIds) {
      await makeCard(user.id, questionId);
    }

    const queue = await getSrsQueue(testDb, { userId: user.id, now: NOW });
    expect(queue.total).toBe(SRS_NEW_PER_DAY);

    // Отвечаем все 20 «Знаю» → они уходят в будущее (today + STEPS[1] = +3).
    for (const card of queue.cards) {
      await reviewSrsCard(testDb, { userId: user.id, cardId: card.id, grade: "good", now: NOW });
    }
    // Очередь пуста: 1 вытесненная новая ещё due-сегодня, но лимит на сегодня исчерпан.
    expect((await getSrsQueue(testDb, { userId: user.id, now: NOW })).total).toBe(0);

    // Ближайшая дата — завтра (вытесненная новая), а не +3 у отвеченных.
    const next = await getNextReviewDate(testDb, { userId: user.id, now: NOW });
    expect(next).toEqual(addDays(TODAY, 1));
  });

  it("без вытеснения возвращает ближайшую будущую дату", async () => {
    const user = await makeStudent();
    const [q1, q2] = await makeQuestions(2);
    await makeCard(user.id, q1!, { nextReviewAt: addDays(TODAY, 5), reviewsCount: 1 });
    await makeCard(user.id, q2!, { nextReviewAt: addDays(TODAY, 2), reviewsCount: 1 });

    expect(await getNextReviewDate(testDb, { userId: user.id, now: NOW })).toEqual(
      addDays(TODAY, 2),
    );
  });
});

describe("границы суток в таймзоне пользователя (spec 0.6)", () => {
  // 2026-07-08T20:00Z: в Окленде (UTC+12) уже 9 июля, в Москве ещё 8 июля.
  const EVENING = new Date("2026-07-08T20:00:00.000Z");

  it("одна и та же дата карточки due для Окленда и не due для Москвы", async () => {
    const moscow = await makeStudent("msk@test.local", "Europe/Moscow");
    const auckland = await makeStudent("akl@test.local", "Pacific/Auckland");
    const [q1, q2] = await makeQuestions(2);
    const july9 = dateOnlyUtc("2026-07-09");
    await makeCard(moscow.id, q1!, { nextReviewAt: july9, reviewsCount: 1 });
    await makeCard(auckland.id, q2!, { nextReviewAt: july9, reviewsCount: 1 });

    const moscowQueue = await getSrsQueue(testDb, { userId: moscow.id, now: EVENING });
    const aucklandQueue = await getSrsQueue(testDb, { userId: auckland.id, now: EVENING });
    expect(moscowQueue.total).toBe(0);
    expect(aucklandQueue.total).toBe(1);
  });

  it("новая карточка получает «сегодня» календарной даты пользователя", async () => {
    const auckland = await makeStudent("akl@test.local", "Pacific/Auckland");
    const [questionId] = await makeQuestions(1);

    await addSrsCardManually(testDb, {
      userId: auckland.id,
      questionId: questionId!,
      now: EVENING,
    });
    const card = await testDb.srsCard.findUniqueOrThrow({
      where: { userId_questionId: { userId: auckland.id, questionId: questionId! } },
    });
    expect(card.nextReviewAt).toEqual(dateOnlyUtc("2026-07-09"));
  });
});
