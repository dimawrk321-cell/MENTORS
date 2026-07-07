import { testDb } from "./db";

// Fixture for stage-3 suites: strict course, module 1 (2 lessons + module test
// + closed question pool), module 2 (1 lesson) — gating across the test.

export interface TestedCourseFixture {
  courseSlug: string;
  moduleId: string;
  module2Id: string;
  lesson1Id: string;
  lesson2Id: string;
  lesson4Id: string;
  categoryId: string;
  /** Closed single-choice questions linked to lesson 1; "a" is always correct. */
  questionIds: string[];
}

export const CORRECT = "a";
export const WRONG = "b";

export async function makeTestedCourse(opts?: {
  poolQuestions?: number;
  poolSize?: number;
  threshold?: number;
  cooldownMinutes?: number;
  enabled?: boolean;
}): Promise<TestedCourseFixture> {
  const poolQuestions = opts?.poolQuestions ?? 5;

  const category = await testDb.questionCategory.create({
    data: { title: "Classic ML", slug: "classic-ml", colorIndex: 0, order: 0 },
  });

  const course = await testDb.course.create({
    data: {
      slug: "course",
      title: "Курс",
      gating: "strict",
      status: "published",
      modules: {
        create: [
          {
            title: "Модуль 1",
            order: 0,
            status: "published",
            lessons: {
              create: [
                { slug: "l1", title: "Урок 1", order: 0, status: "published", contentMd: "# 1" },
                { slug: "l2", title: "Урок 2", order: 1, status: "published", contentMd: "# 2" },
              ],
            },
          },
          {
            title: "Модуль 2",
            order: 1,
            status: "published",
            lessons: {
              create: [
                { slug: "l4", title: "Урок 4", order: 0, status: "published", contentMd: "# 4" },
              ],
            },
          },
        ],
      },
    },
    include: {
      modules: { orderBy: { order: "asc" }, include: { lessons: { orderBy: { order: "asc" } } } },
    },
  });

  const [module1, module2] = course.modules;
  const [lesson1, lesson2] = module1!.lessons;

  await testDb.moduleTest.create({
    data: {
      moduleId: module1!.id,
      poolSize: opts?.poolSize ?? 5,
      threshold: opts?.threshold ?? 80,
      cooldownMinutes: opts?.cooldownMinutes ?? 45,
      enabled: opts?.enabled ?? true,
    },
  });

  const questionIds: string[] = [];
  for (let i = 0; i < poolQuestions; i += 1) {
    const question = await testDb.question.create({
      data: {
        type: "single",
        categoryId: category.id,
        textMd: `Вопрос ${i + 1}`,
        options: [
          { id: CORRECT, text: "Правильный", correct: true },
          { id: WRONG, text: "Неправильный", correct: false },
        ],
        status: "published",
        difficulty: 1,
      },
    });
    await testDb.questionLesson.create({
      data: { questionId: question.id, lessonId: lesson1!.id, inQuiz: false, isKey: false },
    });
    questionIds.push(question.id);
  }

  return {
    courseSlug: course.slug,
    moduleId: module1!.id,
    module2Id: module2!.id,
    lesson1Id: lesson1!.id,
    lesson2Id: lesson2!.id,
    lesson4Id: module2!.lessons[0]!.id,
    categoryId: category.id,
    questionIds,
  };
}
