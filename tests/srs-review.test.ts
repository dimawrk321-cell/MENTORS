import { beforeEach, describe, expect, it } from "vitest";
import {
  getLaggingCategories,
  getLaggingQuestionIds,
  getNextReviewDate,
  getTrainerStats,
  reviewSrsCard,
  SRS_LEARNED_INTERVAL_DAYS,
} from "@/lib/services/srs";
import { addDays, dateOnlyUtc } from "@/lib/utils/dates";
import { createTestUser, resetDb, testDb } from "./helpers/db";

// Обязательный набор этапа 4: оценка карточки (spec 7.6), queue.completed
// строго один раз в день, статистика и «западающие темы».

const NOW = new Date("2026-07-08T12:00:00.000Z"); // Москва: 8 июля, 15:00
const TODAY = dateOnlyUtc("2026-07-08");

beforeEach(async () => {
  await resetDb();
});

async function makeStudent(email = "student@test.local") {
  return createTestUser({ email, passwordHash: "unused" });
}

interface CategorySpec {
  slug: string;
  title: string;
  parentId?: string;
}

async function makeCategory(spec: CategorySpec) {
  return testDb.questionCategory.create({
    data: {
      title: spec.title,
      slug: spec.slug,
      parentId: spec.parentId ?? null,
      colorIndex: 0,
      order: 0,
    },
  });
}

async function makeQuestion(categoryId: string, index: number) {
  return testDb.question.create({
    data: {
      type: "open",
      categoryId,
      textMd: `Вопрос ${index}`,
      answerMd: "Эталон",
      status: "published",
      difficulty: 1,
    },
  });
}

let questionCounter = 0;

async function makeCard(
  userId: string,
  categoryId: string,
  data?: Partial<{ nextReviewAt: Date; step: number; lapses: number; reviewsCount: number }>,
) {
  questionCounter += 1;
  const question = await makeQuestion(categoryId, questionCounter);
  return testDb.srsCard.create({
    data: {
      userId,
      questionId: question.id,
      addedFrom: "manual",
      nextReviewAt: data?.nextReviewAt ?? TODAY,
      step: data?.step ?? 0,
      lapses: data?.lapses ?? 0,
      reviewsCount: data?.reviewsCount ?? 0,
    },
  });
}

describe("reviewSrsCard (spec 7.6)", () => {
  it("good: переход сохранён, записан srs_review и card.reviewed", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    const card = await makeCard(user.id, category.id, { step: 1, reviewsCount: 1 });

    const result = await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: card.id,
      grade: "good",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, prevStep: 1, newStep: 2 });

    const updated = await testDb.srsCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(updated).toMatchObject({ step: 2, lapses: 0, reviewsCount: 2, lastGrade: "good" });
    expect(updated.nextReviewAt).toEqual(addDays(TODAY, 7)); // STEPS[2]

    const reviews = await testDb.srsReview.findMany({ where: { cardId: card.id } });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ grade: "good", prevStep: 1, newStep: 2 });
    expect(reviews[0]!.reviewedAt).toEqual(NOW);

    const events = await testDb.analyticsEvent.findMany({
      where: { type: "card.reviewed", userId: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      cardId: card.id,
      grade: "good",
      prevStep: 1,
      newStep: 2,
    });
  });

  it("again: lapses+1 и next = завтра; hard: step на месте", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    const againCard = await makeCard(user.id, category.id, { step: 3, lapses: 1 });
    const hardCard = await makeCard(user.id, category.id, { step: 3 });

    await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: againCard.id,
      grade: "again",
      now: NOW,
    });
    const afterAgain = await testDb.srsCard.findUniqueOrThrow({ where: { id: againCard.id } });
    expect(afterAgain).toMatchObject({ step: 0, lapses: 2, lastGrade: "again" });
    expect(afterAgain.nextReviewAt).toEqual(addDays(TODAY, 1));

    await reviewSrsCard(testDb, { userId: user.id, cardId: hardCard.id, grade: "hard", now: NOW });
    const afterHard = await testDb.srsCard.findUniqueOrThrow({ where: { id: hardCard.id } });
    expect(afterHard).toMatchObject({ step: 3, lapses: 0, lastGrade: "hard" });
    expect(afterHard.nextReviewAt).toEqual(addDays(TODAY, 16)); // STEPS[3]
  });

  it("step 4 + good → «выучен»: step 5 и +90 дней", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    const card = await makeCard(user.id, category.id, { step: 4 });

    await reviewSrsCard(testDb, { userId: user.id, cardId: card.id, grade: "good", now: NOW });
    const updated = await testDb.srsCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(updated.step).toBe(5);
    expect(updated.nextReviewAt).toEqual(addDays(TODAY, SRS_LEARNED_INTERVAL_DAYS));
  });

  it("двойной сабмит гасится: повторная оценка → not_due", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    const card = await makeCard(user.id, category.id);

    const first = await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: card.id,
      grade: "good",
      now: NOW,
    });
    expect(first.ok).toBe(true);

    const second = await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: card.id,
      grade: "good",
      now: NOW,
    });
    expect(second).toEqual({ ok: false, code: "not_due" });
    expect(await testDb.srsReview.count({ where: { cardId: card.id } })).toBe(1);
  });

  it("чужая карточка → not_found", async () => {
    const user = await makeStudent();
    const stranger = await makeStudent("stranger@test.local");
    const category = await makeCategory({ slug: "c", title: "C" });
    const card = await makeCard(user.id, category.id);

    expect(
      await reviewSrsCard(testDb, {
        userId: stranger.id,
        cardId: card.id,
        grade: "good",
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});

describe("queue.completed — строго один раз в день (spec 7.6)", () => {
  it("эмитится при опустошении очереди и не дублируется в тот же день", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    const card1 = await makeCard(user.id, category.id);
    const card2 = await makeCard(user.id, category.id);

    const first = await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: card1.id,
      grade: "good",
      now: NOW,
    });
    expect(first).toMatchObject({ ok: true, remaining: 1, queueCompleted: false });

    const second = await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: card2.id,
      grade: "again",
      now: NOW,
    });
    expect(second).toMatchObject({ ok: true, remaining: 0, queueCompleted: true });

    let events = await testDb.analyticsEvent.findMany({
      where: { type: "queue.completed", userId: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ day: "2026-07-08" });

    // Добавленная и закрытая позже в тот же день карточка второй эмит не даёт.
    const card3 = await makeCard(user.id, category.id);
    const third = await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: card3.id,
      grade: "good",
      now: NOW,
    });
    expect(third).toMatchObject({ ok: true, remaining: 0, queueCompleted: false });
    events = await testDb.analyticsEvent.findMany({
      where: { type: "queue.completed", userId: user.id },
    });
    expect(events).toHaveLength(1);
  });

  it("на следующий день эмитится снова", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    const card = await makeCard(user.id, category.id);

    await reviewSrsCard(testDb, { userId: user.id, cardId: card.id, grade: "again", now: NOW });

    // Вчерашний again вернул карточку на 9 июля — закрываем очередь ещё раз.
    const nextDay = new Date("2026-07-09T12:00:00.000Z");
    const result = await reviewSrsCard(testDb, {
      userId: user.id,
      cardId: card.id,
      grade: "good",
      now: nextDay,
    });
    expect(result).toMatchObject({ ok: true, remaining: 0, queueCompleted: true });

    const events = await testDb.analyticsEvent.findMany({
      where: { type: "queue.completed", userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => (event.payload as { day: string }).day)).toEqual([
      "2026-07-08",
      "2026-07-09",
    ]);
  });
});

describe("статистика и агрегаторы", () => {
  it("getTrainerStats: отвечено всего, выучено, точность за 30 дней", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    const learned = await makeCard(user.id, category.id, { step: 5 });
    const fresh = await makeCard(user.id, category.id);

    // Старый ответ (вне окна 30 дней) + два свежих: good и again.
    await testDb.srsReview.create({
      data: {
        cardId: learned.id,
        grade: "again",
        reviewedAt: addDays(NOW, -40),
        prevStep: 1,
        newStep: 0,
      },
    });
    await testDb.srsReview.create({
      data: {
        cardId: fresh.id,
        grade: "good",
        reviewedAt: addDays(NOW, -2),
        prevStep: 0,
        newStep: 1,
      },
    });
    await testDb.srsReview.create({
      data: {
        cardId: fresh.id,
        grade: "again",
        reviewedAt: addDays(NOW, -1),
        prevStep: 1,
        newStep: 0,
      },
    });

    const stats = await getTrainerStats(testDb, { userId: user.id, now: NOW });
    expect(stats.answeredTotal).toBe(3);
    expect(stats.learnedCount).toBe(1);
    expect(stats.accuracy30).toBeCloseTo(0.5);

    const empty = await makeStudent("empty@test.local");
    expect(await getTrainerStats(testDb, { userId: empty.id, now: NOW })).toEqual({
      answeredTotal: 0,
      learnedCount: 0,
      accuracy30: null,
    });
  });

  it("западающие темы: топ-3 корневых по доле again, скрыт при <20 ответов", async () => {
    const user = await makeStudent();
    const rootA = await makeCategory({ slug: "a", title: "A" });
    const subA = await makeCategory({ slug: "a-sub", title: "A-sub", parentId: rootA.id });
    const rootB = await makeCategory({ slug: "b", title: "B" });
    const rootC = await makeCategory({ slug: "c", title: "C" });

    async function review(categoryId: string, grade: "again" | "good", count: number) {
      for (let i = 0; i < count; i += 1) {
        const card = await makeCard(user.id, categoryId);
        await testDb.srsReview.create({
          data: {
            cardId: card.id,
            grade,
            reviewedAt: addDays(NOW, -3),
            prevStep: 0,
            newStep: grade === "good" ? 1 : 0,
          },
        });
      }
    }

    // A: 10 ответов, 5 again (50%); под-категория A-sub докидывает в корень
    // ещё 4 ответа с 2 again; B: 10 ответов, 1 again (10%); C: без again.
    await review(rootA.id, "again", 5);
    await review(rootA.id, "good", 5);
    await review(subA.id, "again", 2);
    await review(subA.id, "good", 2);
    await review(rootB.id, "again", 1);
    await review(rootB.id, "good", 9);
    await review(rootC.id, "good", 2);

    const lagging = await getLaggingCategories(testDb, { userId: user.id, now: NOW });
    expect(lagging).not.toBeNull();
    expect(lagging!.map((entry) => entry.title)).toEqual(["A", "B"]); // C без again — не западает
    expect(lagging![0]).toMatchObject({ answers: 14 });
    expect(lagging![0]!.againShare).toBeCloseTo(7 / 14);
    expect(lagging![1]!.againShare).toBeCloseTo(0.1);

    // Меньше 20 ответов за 30 дней — блок скрыт.
    const sparse = await makeStudent("sparse@test.local");
    await testDb.srsReview.deleteMany();
    await testDb.srsCard.deleteMany({ where: { userId: sparse.id } });
    const sparseResult = await getLaggingCategories(testDb, { userId: sparse.id, now: NOW });
    expect(sparseResult).toBeNull();
  });

  it("«мои западающие»: lapses ≥ 1 или карточка из ошибок", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });

    const lapsed = await makeCard(user.id, category.id, { lapses: 1 });
    const fromQuiz = await makeCard(user.id, category.id);
    await testDb.srsCard.update({ where: { id: fromQuiz.id }, data: { addedFrom: "quiz_fail" } });
    const clean = await makeCard(user.id, category.id); // manual, lapses 0

    const ids = await getLaggingQuestionIds(testDb, user.id);
    expect(new Set(ids)).toEqual(new Set([lapsed.questionId, fromQuiz.questionId]));
    expect(ids).not.toContain(clean.questionId);
  });

  it("getNextReviewDate: ближайшая будущая дата, без suspended", async () => {
    const user = await makeStudent();
    const category = await makeCategory({ slug: "c", title: "C" });
    await makeCard(user.id, category.id, { nextReviewAt: addDays(TODAY, 5) });
    await makeCard(user.id, category.id, { nextReviewAt: addDays(TODAY, 2) });

    const next = await getNextReviewDate(testDb, { userId: user.id, now: NOW });
    expect(next).toEqual(addDays(TODAY, 2));

    const empty = await makeStudent("empty@test.local");
    expect(await getNextReviewDate(testDb, { userId: empty.id, now: NOW })).toBeNull();
  });
});
