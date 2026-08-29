import type { Db } from "@/lib/db";
import {
  matchStepDuplicates,
  type StepDuplicate,
  type DuplicateStepInput,
} from "@/lib/utils/lesson-step-duplicates";

/**
 * Ищет опубликованные уроки, содержимое или название которых повторено шагом
 * другого урока ТОГО ЖЕ курса (заход C.10 «Шаги урока»).
 *
 * Запрос идёт от шагов, а не от уроков: шагов на платформе десятки, а уроков
 * сотни, и грузить `content_md` всего дерева ради сверки незачем. Сначала —
 * все шаги (их немного), затем опубликованные уроки только тех курсов, где
 * шаги вообще есть. Стоимость проверки растёт вместе с тем, что проверяется.
 */
export async function findStepDuplicates(
  db: Db,
  courseIds: readonly string[],
): Promise<StepDuplicate[]> {
  if (courseIds.length === 0) return [];
  const stepRows = await db.lessonStep.findMany({
    where: { lesson: { module: { courseId: { in: [...courseIds] } } } },
    select: {
      id: true,
      title: true,
      contentMd: true,
      status: true,
      lesson: {
        select: { id: true, title: true, status: true, module: { select: { courseId: true } } },
      },
    },
  });
  if (stepRows.length === 0) return [];

  const steps: DuplicateStepInput[] = stepRows.map((step) => ({
    id: step.id,
    title: step.title,
    contentMd: step.contentMd,
    status: step.status,
    lessonId: step.lesson.id,
    lessonTitle: step.lesson.title,
    lessonStatus: step.lesson.status,
    courseId: step.lesson.module.courseId,
  }));

  const courseIdsWithSteps = [...new Set(steps.map((step) => step.courseId))];
  const lessonRows = await db.lesson.findMany({
    where: { status: "published", module: { courseId: { in: courseIdsWithSteps } } },
    select: {
      id: true,
      title: true,
      contentMd: true,
      module: { select: { courseId: true } },
    },
  });

  return matchStepDuplicates(
    lessonRows.map((lesson) => ({
      id: lesson.id,
      courseId: lesson.module.courseId,
      title: lesson.title,
      contentMd: lesson.contentMd,
    })),
    steps,
  );
}
