import Link from "next/link";
import { CircleCheck } from "lucide-react";

// Правая колонка страницы курса (заход B.5, референс v2): «Что вы освоите» и
// «После курса». Ширина 280px и липкость — на ≥1060px; ниже колонка уходит под
// программу целиком (класс задаёт страница, здесь только содержимое).
//
// «Что вы освоите» рендерится ТОЛЬКО при непустых данных. Сегодня их взять
// неоткуда: у курса есть название, slug, описание, гейтинг и порядок — списка
// результатов в модели нет (раздел 6), и выдумывать поле в этом заходе нельзя.
// Секция скрыта, пока источник не появится (варианты — в отчёте захода).

export function CourseSideRail({ outcomes = [] }: { outcomes?: string[] }) {
  return (
    <>
      {outcomes.length > 0 && (
        <section className="rounded-card border-border bg-surface-1 shadow-card border px-4.5 py-4">
          <h2 className="text-text-3 mb-2.5 text-[13px] font-bold tracking-[0.07em] uppercase">
            Что вы освоите
          </h2>
          <div className="flex flex-col gap-2.5">
            {outcomes.map((text) => (
              <div key={text} className="text-text-2 flex items-start gap-2.5 text-[13.5px]">
                <CircleCheck
                  size={15}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="text-success mt-0.5 shrink-0"
                />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-card border-border bg-accent/[0.04] border px-4.5 py-4">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em]">После курса</h2>
        <p className="text-text-2 mt-1.5 mb-3 text-[12.5px] leading-relaxed">
          Закрепи материал в тренажёре, а когда курс закрыт — бери мок с интервьюером.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/trainer"
            className="border-border hover:border-border-strong text-text-1 ease-app inline-flex h-8.5 items-center rounded-[9px] border px-3.5 text-[12.5px] font-medium transition-colors duration-150"
          >
            В тренажёр
          </Link>
          {/* Бронь открывается только заработанным курсом (заход B.1), поэтому
              ведём в хаб моков: там ученик увидит либо мастер брони, либо
              объяснение с названием курса, а не обещание, которого не сдержим. */}
          <Link
            href="/mocks"
            className="bg-accent hover:bg-accent-hover ease-app inline-flex h-8.5 items-center rounded-[9px] px-3.5 text-[12.5px] font-medium text-white transition-colors duration-150"
          >
            К мокам
          </Link>
        </div>
      </section>
    </>
  );
}
