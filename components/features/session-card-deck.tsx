"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { BookOpen, ChevronDown, RotateCw } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryChip } from "@/components/features/category-chip";
import { useBottomDock } from "@/components/features/bottom-dock";
import { cn } from "@/lib/utils/cn";
import { isVerticalIntent, resolveSwipe } from "@/lib/utils/card-gesture";

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

export type DeckGrade = "again" | "hard" | "good";

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

export function SessionCardDeck({
  item,
  index,
  total,
  flipped,
  pending,
  active,
  exitHref,
  exitLabel,
  exitConfirm,
  onFlip,
  onGrade,
}: {
  item: DeckItem;
  index: number;
  total: number;
  flipped: boolean;
  pending: boolean;
  /** Дека принимает ввод только пока идёт показ карточек (не на break/done). */
  active: boolean;
  exitHref: string;
  exitLabel: string;
  exitConfirm: string;
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

  return (
    <div
      // Высота грани ограничена вьюпортом: карточка скроллится внутри себя, а
      // шапка сессии и панель оценок остаются на экране при любой длине эталона
      // (spec 13). Вычет (--deck-chrome) и пол высоты живут в globals.css —
      // на альбомной ориентации телефона вычет должен быть меньше, а инлайновый
      // стиль медиазапроса не держит.
      className="session-deck mx-auto flex w-full max-w-2xl flex-col gap-4"
    >
      {/* Шапка сессии липнет к верху: на низком вьюпорте (альбомная ориентация)
          страница всё-таки скроллится, и счётчик с выходом уезжали бы за экран —
          при липкой панели оценок внизу это оставляло карточку без обоих краёв. */}
      <div className="bg-bg sticky top-0 z-10 flex flex-col gap-4 pb-1">
        <div className="flex items-center justify-between">
          <p className="text-text-2 text-[13px]" aria-live="polite">
            {index + 1} / {total}
          </p>
          {/* Hierarchical exit with confirm (spec 12.1/C7). */}
          <BackButton href={exitHref} label={exitLabel} confirmMessage={exitConfirm} />
        </div>

        <div
          className="rounded-pill bg-border h-1 w-full overflow-hidden"
          role="progressbar"
          aria-valuenow={Math.round((index / total) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Прогресс сессии"
        >
          <div
            className="ease-app h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${Math.round((index / total) * 100)}%`,
              backgroundImage: "var(--gradient-accent)",
            }}
          />
        </div>
      </div>

      <div>
        <CategoryChip title={item.category.title} colorIndex={item.category.colorIndex} />
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
        className="bg-bg sticky bottom-0 z-10 flex flex-col gap-2 py-2"
      >
        {flipped ? (
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Оценка карточки">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => grade("again")}
              className={cn("text-danger min-h-11")}
            >
              Не знаю
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => grade("hard")}
              className={cn("text-warning min-h-11")}
            >
              Сомневаюсь
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => grade("good")}
              className={cn("text-success min-h-11")}
            >
              Знаю
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="min-h-11" onClick={() => onFlip(true)}>
            <RotateCw size={15} strokeWidth={1.75} aria-hidden="true" />
            Показать ответ
          </Button>
        )}
        <p className="text-text-3 hidden text-center text-[12px] md:block">
          Space — ответ · 1 / 2 / 3 — оценки · свайпы влево/вправо на мобильном
        </p>
      </div>
    </div>
  );
}
