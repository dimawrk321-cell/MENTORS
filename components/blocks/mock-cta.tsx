import type { ReactNode } from "react";
import Link from "next/link";
import { Lock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOCK_LOCKED_TEXT, MOCK_LOCKED_TITLE } from "@/lib/constants";

const TYPE_LABEL: Record<string, string> = {
  theory: "ML-теория",
  legend: "По легенде",
};

/**
 * :::mock{type} — CTA «Забронировать мок» (spec 7.3, мок-уроки Soft Skills).
 *
 * Заход B.1, блок 3.4: сам CTA подчиняется общему правилу «бронь после первого
 * курса». Автозакрытие мок-урока после проведённого мока (mocks.ts) привязано к
 * НАЛИЧИЮ директивы в тексте и от этого не зависит: директива на месте, блок
 * рисуется, меняется только содержимое кнопки. Конфликта нет — правило
 * запрещает бронировать, а не проходить урок.
 */
export function MockCta({
  type = "legend",
  children,
  locked,
}: {
  type?: string;
  children?: ReactNode;
  /** null/undefined — бронь открыта (и предпросмотр студии, где ученика нет). */
  locked?: { nextCourseTitle: string | null } | null;
}) {
  const label = TYPE_LABEL[type] ?? type;
  return (
    <section className="rounded-card border-border bg-surface-1 my-5 border p-5">
      <h3 className="mb-1 flex items-center gap-2 text-[16px] font-semibold">
        <Video size={17} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Мок-интервью: {label}
      </h3>
      <div className="text-text-2 mb-4 text-[14px]">
        {children || <p>Этот урок закрывается практикой — забронируй мок с живым интервьюером.</p>}
      </div>
      {locked ? (
        <div className="rounded-control border-border bg-surface-2 border px-3.5 py-3">
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Lock
              size={15}
              strokeWidth={1.75}
              className="text-text-3 shrink-0"
              aria-hidden="true"
            />
            {MOCK_LOCKED_TITLE}
          </p>
          <p className="text-text-2 mt-1 text-[13px]">
            {locked.nextCourseTitle
              ? `Сейчас в работе «${locked.nextCourseTitle}» — заверши его, и бронирование откроется.`
              : MOCK_LOCKED_TEXT}
          </p>
          <Link
            href="/courses"
            className="text-accent hover:text-accent-hover mt-2 inline-block text-[13px] font-medium"
          >
            К обучению →
          </Link>
        </div>
      ) : (
        <Button asChild variant="secondary">
          <Link href={`/mocks/book?type=${type}`}>Забронировать мок</Link>
        </Button>
      )}
    </section>
  );
}
