"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { BookOpen, Check, ChevronDown, RotateCw, Sparkles } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryChip } from "@/components/features/category-chip";
import { useBottomDock } from "@/components/features/bottom-dock";
import { cn } from "@/lib/utils/cn";
import { isVerticalIntent, resolveSwipe } from "@/lib/utils/card-gesture";
import {
  DECK_RHYTHM_MAX_SEGMENTS,
  rhythmSegments,
  type SessionGrade,
} from "@/lib/utils/session-summary";

// Презентационная дека карточек (spec 7.6/13/14) — общая для дневной очереди
// (ReviewSession) и свободной тренировки (FreeSession).
//
// Вынесена ИЗ review-session.tsx дословно: разметка, классы, тексты, пороги
// свайпа и раскладка клавиш перенесены как есть. Режимы отличаются только тем,
// что происходит ПОСЛЕ оценки, — это остаётся в вызывающих компонентах, а
// внешний вид и ввод у них общие и не могут разъехаться.
//
// /trainer/session — ежедневный ритуал: любое отличие поведения здесь считается
// регрессом, поэтому дека не знает ни про SRS, ни про прогон и не принимает
// решений — только рисует и зовёт onGrade/onFlip.
//
// Заход «Мобильный тренажёр и тосты» (по скринам с телефонов учеников):
//   • тело карточки скроллится ВНУТРИ себя (высота ограничена вьюпортом), чтобы
//     кнопки оценки не уезжали за экран при длинном эталоне;
//   • жест переключения отделён от скролла — см. lib/utils/card-gesture.ts;
//   • при раскрытом ответе вопрос доступен целиком: компактная строка сверху,
//     тап разворачивает её в полный текст.
//
// Заход C.8 «Сессия повторений v2» (по прототипу «PRIME - Сессия повторений»):
//   • полоса прогресса → ритм по карточкам (сегмент на карточку, цвет — оценка);
//   • мета-строка под шапкой: категория, «Новая карточка», источник карточки;
//   • кнопки оценок 52px с цветом оценки и подсказками клавиш от 700px;
//   • инлайн-подтверждение над панелью вместо тоста «Следующее повторение».
// Ни один из существующих механизмов деки при этом не тронут.

export interface DeckItem {
  /** Ключ перемонтирования граней: cardId в очереди, questionId в прогоне. */
  id: string;
  category: { title: string; colorIndex: number };
  lesson: { id: string; title: string } | null;
  /** Вопрос простым текстом — компактная строка над раскрытым ответом. */
  questionText: string;
  questionNode: ReactNode;
  answerNode: ReactNode;
}

export type DeckGrade = SessionGrade;

/** Сколько живёт инлайн-подтверждение после оценки (заход C.8). */
export const DECK_OUTCOME_MS = 2600;

export interface DeckOutcome {
  grade: DeckGrade;
  /**
   * Карточка, НА которой показывается полоса, — то есть следующая после
   * оценённой. Видимость подтверждения — чистое правило от пропсов
   * (`outcome.itemId === item.id`), а не эффект: так полоса не может пережить
   * переход к следующей карточке ни на одной ветке вызывающего компонента.
   */
  itemId: string;
  /** Урок ОЦЕНЁННОЙ карточки — для ссылки «Перечитать урок →»; null, если урока нет. */
  lessonId: string | null;
}

const OUTCOME_COPY: Record<DeckGrade, { title: string; text: string; color: string }> = {
  good: {
    title: "Знаю.",
    text: "Записано, карточка ушла на следующий круг",
    color: "var(--success)",
  },
  hard: {
    title: "Сомневаюсь.",
    text: "Записано, карточка ушла на следующий круг",
    color: "var(--warning)",
  },
  again: {
    title: "Не знаю.",
    // Дат в тексте нет осознанно: «вернётся через N дней» до выбора провоцирует
    // занижать или завышать оценку (заход C.8).
    text: "Эта карточка вернётся ещё раз — перечитай урок, когда будет время",
    color: "var(--danger)",
  },
};

/**
 * Таймер инлайн-подтверждения: живёт у вызывающего компонента, снимается в
 * cleanup и при каждой следующей оценке. Дека остаётся презентационной — она
 * только рисует то, что пришло пропом.
 */
export function useGradeOutcome(): {
  outcome: DeckOutcome | null;
  showOutcome: (next: DeckOutcome) => void;
  clearOutcome: () => void;
} {
  const [outcome, setOutcome] = useState<DeckOutcome | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const clearOutcome = useCallback(() => {
    stop();
    setOutcome(null);
  }, [stop]);

  const showOutcome = useCallback(
    (next: DeckOutcome) => {
      stop();
      setOutcome(next);
      timer.current = setTimeout(() => setOutcome(null), DECK_OUTCOME_MS);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { outcome, showOutcome, clearOutcome };
}

interface Gesture {
  x: number;
  y: number;
  /** Скролл страницы и тела карточки на момент начала касания. */
  pageY: number;
  scroller: HTMLElement | null;
  scrollTop: number;
  vertical: boolean;
  insideScrollableX: boolean;
}

/**
 * Касание началось внутри горизонтально прокручиваемого блока (код, KaTeX,
 * широкая таблица)? Тогда это прокрутка содержимого, а не свайп по карточке —
 * ровно тот случай со скрина: вопрос про asyncio, текст + список + блок кода.
 */
function startedInScrollableX(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node.scrollWidth - node.clientWidth > 2) return true;
    if (node === root) return false;
    node = node.parentElement;
  }
  return false;
}

/** Ближайший вертикальный скроллер (тело карточки) или null — тогда скроллит страница. */
function scrollerFor(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let node = target instanceof Element ? (target as HTMLElement) : null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight - node.clientHeight > 2
    ) {
      return node;
    }
    if (node === root) return null;
    node = node.parentElement;
  }
  return null;
}

/** Цвет сегмента ритма — по фактической оценке (spec 5.1: только токены темы). */
const GRADE_COLOR: Record<DeckGrade, string> = {
  good: "var(--success)",
  hard: "var(--warning)",
  again: "var(--danger)",
};

export function SessionCardDeck({
  item,
  index,
  total,
  grades,
  step,
  sourceLabel,
  flipped,
  pending,
  active,
  exitHref,
  exitLabel,
  exitConfirm,
  note,
  outcome,
  onFlip,
  onGrade,
}: {
  item: DeckItem;
  index: number;
  total: number;
  /** Оценки текущей порции по порядку — ритм. Копит вызывающий компонент. */
  grades: DeckGrade[];
  /** Ступень карточки: рисуется только «Новая карточка» при 0. В прогоне ступени нет. */
  step?: number;
  /** Источник карточки человеческой формулировкой (lib/services/srs.ts). */
  sourceLabel?: string;
  flipped: boolean;
  pending: boolean;
  /** Дека принимает ввод только пока идёт показ карточек (не на break/done). */
  active: boolean;
  exitHref: string;
  exitLabel: string;
  exitConfirm: string;
  /** Строка режима под счётчиком (заход B.2): чем этот прогон отличается. */
  note?: string;
  /**
   * Инлайн-подтверждение после оценки. Сам факт передачи пропа (пусть и `null`)
   * резервирует под полосу постоянное место: высота слота входит в
   * `--deck-chrome`, поэтому появление и исчезновение полосы не двигают
   * карточку. Режим, который ничего не записывает по ходу (свободная
   * тренировка), проп не передаёт вовсе — там и обещать «записано» нечего.
   */
  outcome?: DeckOutcome | null;
  onFlip: (next: boolean) => void;
  onGrade: (grade: DeckGrade) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  // Панель оценок — нижний док focused-зоны: BottomNav тут нет, и тост должен
  // вставать над ПАНЕЛЬЮ (lib/utils/bottom-dock.ts).
  const panelRef = useBottomDock<HTMLDivElement>();
  // Компактная строка вопроса над ответом: развёрнутое состояние живёт до
  // следующей карточки, чтобы тап не приходилось повторять на каждой грани.
  const [questionOpen, setQuestionOpen] = useState(false);
  useEffect(() => setQuestionOpen(false), [item.id]);

  function grade(value: DeckGrade): void {
    if (!flipped || pending || !active) return;
    onGrade(value);
  }

  // Слушатель клавиатуры вешается один раз и читает свежее состояние из рефа.
  // Раньше эффект пересоздавался по списку зависимостей — при выносе деки это
  // стало бы источником устаревших замыканий (`onGrade` меняется каждый рендер).
  const latest = useRef({ flipped, pending, active, onFlip, onGrade });
  latest.current = { flipped, pending, active, onFlip, onGrade };

  // Клавиатура (spec 14): Space — флип, 1/2/3 — оценки.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const state = latest.current;
      if (!state.active) return;
      // Не перехватываем Space/цифры у сфокусированного контрола — пусть кнопка
      // или ссылка активируется штатно (spec 14: полная клавиатурная навигация).
      // `instanceof Element`, а не приведение типа: целью keydown может быть и
      // `document` (когда сфокусированный элемент только что убрали из дерева) —
      // у него нет `closest`, и обработчик падал бы целиком.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("button, a, input, textarea, select")) return;
      if (event.code === "Space") {
        event.preventDefault();
        state.onFlip(!state.flipped);
        return;
      }
      const key = event.key;
      if (key !== "1" && key !== "2" && key !== "3") return;
      if (!state.flipped || state.pending) return;
      state.onGrade(key === "1" ? "again" : key === "2" ? "hard" : "good");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Жест: копим признаки во время касания и решаем один раз на touchend.
  // preventDefault не зовём вовсе — React вешает touchstart/touchmove на корень
  // ПАССИВНО, и на разных движках отменить прокрутку отсюда всё равно нельзя.
  // `touch-action` тоже не трогаем: глобальный `pan-y` на карточке отобрал бы у
  // блоков кода их собственную горизонтальную прокрутку — то самое содержимое,
  // ради которого всё и затевалось. Прокруткой владеет браузер, дека только
  // наблюдает и отбрасывает свои жесты (lib/utils/card-gesture.ts).
  function onTouchStart(event: TouchEvent<HTMLDivElement>): void {
    const touch = event.touches[0];
    if (!touch) {
      gesture.current = null;
      return;
    }
    const root = event.currentTarget;
    const scroller = scrollerFor(event.target, root);
    gesture.current = {
      x: touch.clientX,
      y: touch.clientY,
      pageY: window.scrollY,
      scroller,
      scrollTop: scroller?.scrollTop ?? 0,
      vertical: false,
      insideScrollableX: startedInScrollableX(event.target, root),
    };
  }

  function onTouchMove(event: TouchEvent<HTMLDivElement>): void {
    const start = gesture.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    // Намерение читается по всему движению, а не по конечной точке: палец,
    // ушедший вниз и вернувшийся, — это скролл, а не свайп.
    if (isVerticalIntent(touch.clientX - start.x, touch.clientY - start.y)) start.vertical = true;
  }

  function onTouchEnd(event: TouchEvent<HTMLDivElement>): void {
    const start = gesture.current;
    gesture.current = null;
    if (!start || !flipped || pending) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const scrolled =
      Math.abs(window.scrollY - start.pageY) > 4 ||
      Math.abs((start.scroller?.scrollTop ?? 0) - start.scrollTop) > 4;
    const outcome = resolveSwipe({
      dx: touch.clientX - start.x,
      dy: touch.clientY - start.y,
      verticalIntent: start.vertical,
      insideScrollableX: start.insideScrollableX,
      scrolled,
    });
    if (outcome) grade(outcome);
  }

  // Пол высоты грани (заход «Хвосты по тостам и высоте»): min-h тоже считается
  // от --deck-face-max, иначе на низком вьюпорте min-height (240px) перебивал бы
  // max-height (62px на альбомном 844×390) и карточка вылезала бы за экран.
  const faceClass =
    "flex max-h-[var(--deck-face-max)] min-h-[min(15rem,var(--deck-face-max))] flex-col md:min-h-[min(17.5rem,var(--deck-face-max))]";
  const bodyClass = "min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 md:p-6";
  const captionClass = "text-text-3 mb-3 text-[12px] font-medium tracking-wide uppercase";

  const progressNow = Math.round(((index + 1) / total) * 100);
  const rhythm = total <= DECK_RHYTHM_MAX_SEGMENTS;
  const shownOutcome = outcome && outcome.itemId === item.id ? outcome : null;
  const outcomeCopy = shownOutcome ? OUTCOME_COPY[shownOutcome.grade] : null;

  return (
    <div
      // Высота грани ограничена вьюпортом: карточка скроллится внутри себя, а
      // шапка сессии и панель оценок остаются на экране при любой длине эталона
      // (spec 13). Вычет (--deck-chrome) и пол высоты живут в globals.css —
      // на альбомной ориентации телефона вычет должен быть меньше, а инлайновый
      // стиль медиазапроса не держит. `data-outcome` включает в тот же вычет
      // постоянное место под инлайн-подтверждение (заход C.8).
      className="session-deck mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3.5"
      data-outcome={outcome !== undefined ? "" : undefined}
    >
      {/* Шапка сессии липнет к верху: на низком вьюпорте (альбомная ориентация)
          страница всё-таки скроллится, и счётчик с выходом уезжали бы за экран —
          при липкой панели оценок внизу это оставляло карточку без обоих краёв.

          Заход B.4: шапка собрана в один блок — счётчик, пояснение режима и
          выход в строке, полоса прогресса прижата к нижнему краю той же строки.
          Раньше между ними стоял gap-4, и полоса читалась отдельной волосяной
          линией, ни к чему не относящейся. */}
      <div className="bg-bg sticky top-0 z-10 flex flex-col gap-2 pt-1 pb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Иерархия (B.4/2.4): счётчик — главное число экрана, пояснение
                режима под ним и приглушённое. Раньше оба стояли в строку одним
                весом, и «тренировка · без XP и серии» спорило со счётчиком. */}
            <p
              className="text-text-1 text-[16px] leading-tight font-semibold tabular-nums"
              aria-live="polite"
            >
              {index + 1}
              <span className="text-text-3 font-normal"> / {total}</span>
            </p>
            {note && <p className="text-text-3 mt-0.5 text-[12px]">{note}</p>}
          </div>
          {/* Выход из сессии (spec 12.1/C7): подтверждение остаётся, стрелка
              снята — см. комментарий в BackButton. */}
          <BackButton
            href={exitHref}
            label={exitLabel}
            confirmMessage={exitConfirm}
            arrow={false}
          />
        </div>

        {/* Ритм по карточкам (заход C.8): сегмент на карточку, цвет — фактическая
            оценка. Скринридеру цвет не читается, поэтому контейнер остаётся
            progressbar с процентом и подписью «Карточка N из M», а сегменты
            выведены из дерева доступности. Выше порога сегменты тоньше волоса —
            там рисуется прежняя сплошная полоса. */}
        <div
          className={cn(
            rhythm ? "flex gap-[3px]" : "rounded-pill bg-border h-1 w-full overflow-hidden",
          )}
          role="progressbar"
          aria-valuenow={progressNow}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Карточка ${index + 1} из ${total}`}
        >
          {rhythm ? (
            rhythmSegments(grades, total, index, active).map((segment, position) => (
              <span
                // Ключ по позиции: сегменты — это и есть позиции в порции,
                // другого тождества у них нет.
                key={position}
                aria-hidden="true"
                className="rounded-pill block h-1.5 flex-1"
                style={
                  segment.kind === "graded"
                    ? { background: GRADE_COLOR[segment.grade] }
                    : segment.kind === "current"
                      ? {
                          backgroundImage: "var(--gradient-accent)",
                          boxShadow: "0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent)",
                        }
                      : { background: "var(--heat-empty)" }
                }
              />
            ))
          ) : (
            <div
              className="ease-app h-full rounded-full transition-[width] duration-300"
              style={{
                // index нулевой, а счётчик на экране человеческий: первая
                // карточка из 15 — это уже 1/15, не 0%.
                width: `${progressNow}%`,
                backgroundImage: "var(--gradient-accent)",
              }}
            />
          )}
        </div>
      </div>

      {/* Мета-строка карточки (заход C.8): откуда она и новая ли она. Сроков и
          интервалов здесь нет и быть не должно. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* wrap: имя категории показывается целиком (B.4/2.1) — строка её, делить
            ширину не с кем. Самое длинное имя в банке — 48 символов. */}
        <CategoryChip title={item.category.title} colorIndex={item.category.colorIndex} wrap />
        {step === 0 && (
          <span className="rounded-pill border-border text-text-2 inline-flex items-center gap-1.5 border px-2.5 py-[3px] text-[12px]">
            <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            Новая карточка
          </span>
        )}
        {sourceLabel && (
          <span className="text-text-3 inline-flex min-w-0 items-center gap-1.5 text-[12px]">
            <BookOpen size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0">{sourceLabel}</span>
          </span>
        )}
      </div>

      {/* Флип-карточка: горизонтальные свайпы по открытому ответу = оценки
          (spec 7.6). Вертикаль отдана скроллу целиком. */}
      <div
        className="relative [perspective:1200px]"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          gesture.current = null;
        }}
      >
        {/* key по карточке: переход к следующей монтирует грани заново на
            rotateY(0), без анимации разворота (иначе мелькнул бы ответ). */}
        {/* Spec 5.4: reduced-motion — флип заменяется мгновенной сменой. */}
        {/* grid-cols-[minmax(0,1fr)] — иначе неявная auto-колонка меряется по
            max-content граней: широкая строка кода в эталоне растягивала колонку
            до ~1200px при вьюпорте 390 и давала горизонтальный оверфлоу ВСЕЙ
            страницы (spec 13 — «никакого horizontal overflow на 360px»). Это же
            и ломало жест: палец тянул страницу вбок, а не блок кода, и на
            touchend дека видела «свайп». Замер на 390px до правки: scrollWidth
            889 при clientWidth 390, `pre` шириной 821 без собственной прокрутки;
            после — 390/390, код скроллится внутри себя. */}
        <div
          key={item.id}
          className="ease-app relative grid grid-cols-[minmax(0,1fr)] transition-transform duration-250 [transform-style:preserve-3d] motion-reduce:transition-none"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          {/* inert на неактивной грани убирает её из фокуса и дерева
              доступности — backface-visibility прячет только визуально.

              max-h-0 на скрытой грани — находка владельца («вопрос виден, тело
              пустое, выхода нет»): обе грани лежат в ОДНОЙ ячейке grid, поэтому
              высота ячейки была максимумом из двух. Короткий вопрос с длинным
              эталоном давал лицевую грань в 1214px при вьюпорте 720px — экран
              пустоты и кнопка «Показать ответ» за его пределами. Скрытую грань
              всё равно не видно (backface-visibility), так что в расчёт высоты
              она входить не должна. */}
          <div
            className={cn(
              "col-start-1 row-start-1 [backface-visibility:hidden]",
              flipped && "max-h-0 overflow-hidden",
            )}
            inert={flipped}
          >
            <Card className={faceClass}>
              <div className={bodyClass}>
                <p className={captionClass}>Вопрос</p>
                <div className="lesson-prose text-[17px]">{item.questionNode}</div>
              </div>
            </Card>
          </div>
          <div
            className={cn(
              "col-start-1 row-start-1 [transform:rotateY(180deg)] [backface-visibility:hidden]",
              !flipped && "max-h-0 overflow-hidden",
            )}
            inert={!flipped}
          >
            <Card className={faceClass}>
              {/* Вопрос над ответом (заход «Мобильный тренажёр и тосты»): на
                  телефоне раскрытый эталон занимал экран целиком и вопрос было
                  не перечитать. Компактная строка сверху не скроллится вместе с
                  ответом, а тап разворачивает вопрос полностью — ничего не
                  обрезается без возможности прочитать. */}
              <div className="border-border shrink-0 border-b px-5 py-1.5 md:px-6">
                <button
                  type="button"
                  onClick={() => setQuestionOpen((open) => !open)}
                  aria-expanded={questionOpen}
                  className="ease-app text-text-2 hover:text-text-1 flex min-h-11 w-full items-center gap-2 text-left transition-colors duration-150"
                >
                  <span className="text-text-3 shrink-0 text-[11px] font-medium tracking-wide uppercase">
                    Вопрос
                  </span>
                  <span className={cn("min-w-0 flex-1 text-[13px]", !questionOpen && "truncate")}>
                    {questionOpen ? (
                      <span className="text-text-3">Свернуть</span>
                    ) : (
                      item.questionText
                    )}
                  </span>
                  <ChevronDown
                    size={15}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={cn(
                      "text-text-3 ease-app shrink-0 transition-transform duration-150",
                      questionOpen && "rotate-180",
                    )}
                  />
                </button>
                {questionOpen && (
                  <div className="lesson-prose max-h-[38dvh] overflow-y-auto overscroll-contain pb-3 text-[14px]">
                    {item.questionNode}
                  </div>
                )}
              </div>
              <div className={bodyClass}>
                <p className={captionClass}>Эталонный ответ</p>
                <div className="lesson-prose text-[15px]">{item.answerNode}</div>
                {item.lesson && (
                  <Link
                    href={`/lessons/${item.lesson.id}`}
                    className="text-accent hover:text-accent-hover mt-4 flex w-fit items-center gap-1.5 text-[13px]"
                  >
                    <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />
                    Открыть урок: {item.lesson.title}
                  </Link>
                )}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Оценки внизу, тач-зоны ≥44px (spec 13); sticky над BottomNav.
          Липкость теперь на ВСЕХ разрешениях (была только на мобильном): на
          десктопе панель уезжала вниз вместе с длинным эталоном, и «выхода» с
          карточки на экране не оставалось — вторая половина той же находки. */}
      <div
        ref={panelRef}
        data-bottom-dock
        // mt-auto прижимает действие к низу на короткой карточке; sticky
        // сохраняет его на экране, когда длинный вопрос всё же требует скролла.
        className="bg-bg sticky bottom-0 z-10 mt-auto flex flex-col gap-2 pt-3.5 pb-2"
      >
        {outcome !== undefined && (
          // Постоянное место под подтверждение: высота слота фиксирована и
          // входит в --deck-chrome, поэтому появление и исчезновение полосы
          // сдвигают тело карточки ровно на ноль пикселей. aria-live висит на
          // слоте, а не на полосе, — контейнер должен существовать до того, как
          // в него приедет текст.
          <div className="h-[var(--deck-outcome-h)] shrink-0" aria-live="polite">
            {shownOutcome && outcomeCopy && (
              <div
                className="deck-outcome flex h-full items-center gap-2.5 overflow-hidden border px-3.5 motion-safe:animate-[deck-outcome_180ms_ease-out]"
                style={{
                  borderColor: `color-mix(in srgb, ${outcomeCopy.color} 32%, transparent)`,
                  background: `color-mix(in srgb, ${outcomeCopy.color} 8%, transparent)`,
                }}
              >
                <span
                  aria-hidden="true"
                  className="flex size-[22px] shrink-0 items-center justify-center rounded-full text-white"
                  style={{ background: outcomeCopy.color }}
                >
                  {shownOutcome.grade === "again" ? (
                    <RotateCw size={13} strokeWidth={2.25} />
                  ) : (
                    <Check size={13} strokeWidth={2.5} />
                  )}
                </span>
                <p className="text-text-1 min-w-0 flex-1 text-[13px] leading-snug">
                  <span className="font-semibold">{outcomeCopy.title}</span>{" "}
                  <span className="text-text-2">{outcomeCopy.text}</span>
                  {shownOutcome.grade === "again" && shownOutcome.lessonId && (
                    <>
                      {" "}
                      {/* Ссылка внутри абзаца, а не отдельным флекс-элементом:
                          так она переносится вместе с текстом и полоса
                          укладывается в свою постоянную высоту на 390px. */}
                      <Link
                        href={`/lessons/${shownOutcome.lessonId}`}
                        className="text-accent hover:text-accent-hover font-medium whitespace-nowrap"
                      >
                        Перечитать урок →
                      </Link>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {flipped ? (
          <div
            className="grid grid-cols-3 gap-2 max-[699px]:grid-cols-1"
            role="group"
            aria-label="Оценка карточки"
          >
            <GradeButton grade="again" label="Не знаю" hint="1" pending={pending} onClick={grade} />
            <GradeButton
              grade="hard"
              label="Сомневаюсь"
              hint="2"
              pending={pending}
              onClick={grade}
            />
            <GradeButton grade="good" label="Знаю" hint="3" pending={pending} onClick={grade} />
          </div>
        ) : (
          <Button
            variant="secondary"
            className="deck-flip bg-surface-1 border-border-strong hover:border-accent min-h-[50px] text-[15px] max-md:min-h-[50px]"
            onClick={() => onFlip(true)}
          >
            <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />
            Показать ответ
          </Button>
        )}
        <p className="text-text-3 hidden text-center text-[12px] min-[700px]:block">
          Space — ответ · 1 / 2 / 3 — оценки · свайпы влево/вправо на мобильном
        </p>
      </div>
    </div>
  );
}

/**
 * Кнопка оценки (заход C.8): цвет текста — по оценке, на ховере тонкая рамка и
 * подложка того же цвета. Тинт живёт классом `.deck-grade` в globals.css:
 * `color-mix` от переменной оценки утилитой не выражается, а неслоёное правило
 * перебивает ховер варианта `secondary` (тот же приём, что у
 * `.guides-section-nav[data-reading]`).
 */
function GradeButton({
  grade,
  label,
  hint,
  pending,
  onClick,
}: {
  grade: DeckGrade;
  label: string;
  hint: string;
  pending: boolean;
  onClick: (grade: DeckGrade) => void;
}) {
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() => onClick(grade)}
      style={{ ["--deck-grade" as string]: GRADE_COLOR[grade] }}
      className="deck-grade bg-surface-1 min-h-[52px] text-[15px] font-semibold max-md:min-h-[52px]"
    >
      <span style={{ color: GRADE_COLOR[grade] }}>{label}</span>
      <kbd className="border-border text-text-3 rounded-[4px] border px-1 font-sans text-[10.5px] font-normal max-[699px]:hidden">
        {hint}
      </kbd>
    </Button>
  );
}
