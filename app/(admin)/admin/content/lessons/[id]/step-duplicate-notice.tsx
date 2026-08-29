import { CopyX } from "lucide-react";
import type { StepDuplicate } from "@/lib/utils/lesson-step-duplicates";

/**
 * Заход C.10. Исходный урок, скопированный в шаг, остаётся отдельной строкой
 * модуля, и код за этим не следит — его уводят в черновик руками. Скрывать
 * автоматически нельзя (снятие чужого урока с публикации — решение ментора,
 * а не платформы), поэтому последствие называется словами там, где на него
 * можно нажать: в дереве контента и здесь, в редакторе урока.
 *
 * Формулировка идёт от причины совпадения, а не только от видимости: совпало
 * содержимое — ученик действительно читает одно и то же дважды; совпало одно
 * название — материал может быть и разным, и тогда это брошенное название
 * копии, а не дубль. Обещать «видит дважды» во втором случае нельзя.
 */
export function StepDuplicateNotice({
  lessonId,
  duplicates,
}: {
  lessonId: string;
  duplicates: readonly StepDuplicate[];
}) {
  const asSource = duplicates.filter((item) => item.lessonId === lessonId);
  const asHost = duplicates.filter((item) => item.stepLessonId === lessonId);
  if (asSource.length === 0 && asHost.length === 0) return null;

  return (
    <div className="rounded-card border-warning/40 bg-warning/8 flex items-start gap-2 border px-3 py-2.5 text-[13px]">
      <CopyX
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
        className="text-warning mt-0.5 shrink-0"
      />
      <div className="text-text-2 flex flex-col gap-1.5">
        {asSource.map((item) => (
          <p key={`source-${item.stepId}`}>
            <strong className="text-text-1 font-medium">
              {item.reason === "content"
                ? item.visibleTwice
                  ? "Ученик видит этот материал дважды."
                  : "Этот урок целиком лежит копией в шаге."
                : "Шаг другого урока называется так же, как этот урок."}
            </strong>{" "}
            {item.reason === "content"
              ? `Содержимое совпадает с шагом «${item.stepTitle}» в уроке «${item.stepLessonTitle}».`
              : `Шаг «${item.stepTitle}» в уроке «${item.stepLessonTitle}» носит это название — так остаётся копия, у которой название взяли от источника.`}{" "}
            Шаг — независимая копия, а не ссылка, поэтому развести их можно только руками: снять
            этот урок с публикации, переименовать шаг или удалить его.
          </p>
        ))}
        {asHost.map((item) => (
          <p key={`host-${item.stepId}`}>
            <strong className="text-text-1 font-medium">
              {item.reason === "content"
                ? `Шаг «${item.stepTitle}» повторяет опубликованный урок курса.`
                : `Шаг «${item.stepTitle}» назван как опубликованный урок курса.`}
            </strong>{" "}
            {item.reason === "content"
              ? `Его содержимое совпадает с уроком «${item.lessonTitle}», и урок остался отдельной строкой в программе.`
              : `Урок «${item.lessonTitle}» с таким названием опубликован отдельной строкой в программе, а содержимое у шага уже другое — скорее всего, у копии осталось чужое название.`}
          </p>
        ))}
      </div>
    </div>
  );
}
