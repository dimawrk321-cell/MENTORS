"use client";

import Link from "next/link";
import { useBottomDock } from "@/components/features/bottom-dock";

/**
 * Sticky «Продолжить: {урок}» bar (walk 12.3, P2). Sits just above the BottomNav
 * (56px + safe-area) so it never overlaps it. Solid accent — the gradient is
 * reserved for the dashboard hero / goal ring / level-up (spec 5.1).
 *
 * Помечен нижним доком (заход «Хвосты по тостам и высоте»): тост должен вставать
 * над CTA, а не поверх него. Собственный отступ CTA остаётся константой от
 * BottomNav сознательно — читать `--bottom-dock` тут нельзя, элемент сам в него
 * вкладывается, и получилась бы обратная связь «сдвинулся → вырос → сдвинулся».
 * Клиентский компонент только ради замера; разметка и классы не менялись.
 */
export function CourseStickyCta({
  lessonId,
  lessonTitle,
}: {
  lessonId: string;
  lessonTitle: string;
}) {
  const dockRef = useBottomDock<HTMLDivElement>();

  return (
    <div
      ref={dockRef}
      data-bottom-dock
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 px-4 md:hidden"
    >
      <Link
        href={`/lessons/${lessonId}`}
        className="bg-accent hover:bg-accent-hover ease-app rounded-control flex h-12 items-center justify-center gap-2 px-4 text-[15px] font-medium text-white shadow-[0_2px_16px_rgb(0_0_0/0.24)] transition-colors duration-150 active:scale-[.98]"
      >
        <span className="shrink-0 text-white/75">Продолжить:</span>
        <span className="truncate">{lessonTitle}</span>
      </Link>
    </div>
  );
}
