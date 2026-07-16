"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import type { RunScreenData, RunQuestion } from "@/lib/services/mock-queries";
import {
  isRoomUrlReady,
  MOCK_MARK_LABEL,
  MOCK_TYPE_LABEL,
  MOCK_VERDICT_LABEL,
} from "@/lib/constants";
import { categoryColorVar } from "@/lib/utils/category-color";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  completeMockAction,
  markNoShowAction,
  saveNotesAction,
  setQuestionMarkAction,
} from "@/lib/actions/interviewer";

type Mark = "answered" | "partial" | "failed";

const MARK_OPTIONS: Mark[] = ["answered", "partial", "failed"];
const MARK_ACTIVE: Record<Mark, string> = {
  answered: "bg-success/12 text-success border-success/40",
  partial: "bg-warning/12 text-warning border-warning/40",
  failed: "bg-danger/12 text-danger border-danger/40",
};

function StudentCard({ student }: { student: RunScreenData["student"] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-[16px] font-semibold">{student.studentName}</p>
          <p className="text-text-3 text-[13px]">Проведено моков: {student.mocksCompleted}</p>
        </div>

        {student.courses.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-text-3 text-[12px]">Прогресс по курсам</p>
            {student.courses.map((course) => (
              <div key={course.title} className="flex flex-col gap-1">
                <div className="flex justify-between gap-2 text-[13px]">
                  <span className="truncate">{course.title}</span>
                  <span className="text-text-2 tabular-nums">{course.progressPct}%</span>
                </div>
                <ProgressBar value={course.progressPct} aria-label={course.title} />
              </div>
            ))}
          </div>
        )}

        {student.lagging && student.lagging.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-text-3 text-[12px]">Западающие категории</p>
            <div className="flex flex-wrap gap-1.5">
              {student.lagging.map((cat) => (
                <Badge
                  key={cat.categoryId}
                  style={{
                    color: categoryColorVar(cat.colorIndex),
                    background: `color-mix(in srgb, ${categoryColorVar(cat.colorIndex)} 12%, transparent)`,
                  }}
                >
                  {cat.title} · {Math.round(cat.againShare * 100)}%
                </Badge>
              ))}
            </div>
          </div>
        )}

        {student.pastMocks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-text-3 text-[12px]">Прошлые моки</p>
            {student.pastMocks.map((mock, i) => (
              <p key={i} className="text-text-2 text-[13px]">
                {MOCK_TYPE_LABEL[mock.type]}
                {mock.verdict ? ` — ${MOCK_VERDICT_LABEL[mock.verdict]}` : ""}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NotesPanel({ bookingId, initial }: { bookingId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onChange = (value: string) => {
    setText(value);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await saveNotesAction({ bookingId, text: value });
      if (res.ok) setSaved(true);
    }, 800);
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-text-3 text-[12px]">Заметки</p>
          <span className="text-text-3 text-[11px]">{saved ? "Сохранено" : "Сохраняем…"}</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          placeholder="Заметки по ходу интервью — сохраняются автоматически"
          className="rounded-control border-border text-text-1 placeholder:text-text-3 ease-app hover:border-border-strong w-full resize-y border bg-transparent px-3 py-2 text-[14px] transition-colors duration-150"
          aria-label="Заметки интервьюера"
        />
      </CardContent>
    </Card>
  );
}

function QuestionRow({ bookingId, question }: { bookingId: string; question: RunQuestion }) {
  const [mark, setMark] = useState<Mark | null>(question.mark);
  const [, start] = useTransition();

  const toggle = (value: Mark) => {
    const next = mark === value ? null : value;
    setMark(next);
    start(async () => {
      const res = await setQuestionMarkAction({ bookingId, questionId: question.id, mark: next });
      if (!res.ok) toast({ title: res.error.message, variant: "danger" });
    });
  };

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <details className="group">
        <summary className="cursor-pointer list-none text-[14px]">
          <span className="line-clamp-2 group-open:line-clamp-none">{question.textMd}</span>
        </summary>
        {question.answerMd && (
          <div className="text-text-2 border-border mt-2 border-l-2 pl-3 text-[13px] whitespace-pre-wrap">
            {question.answerMd}
          </div>
        )}
      </details>
      <div className="flex flex-wrap gap-1.5">
        {MARK_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => toggle(option)}
            aria-pressed={mark === option}
            className={cn(
              "rounded-control border-border ease-app flex h-8 items-center gap-1 border px-2.5 text-[12px] transition-colors duration-150",
              mark === option ? MARK_ACTIVE[option] : "text-text-2 hover:border-border-strong",
            )}
          >
            {mark === option && <Check size={13} strokeWidth={2} aria-hidden="true" />}
            {MOCK_MARK_LABEL[option]}
          </button>
        ))}
      </div>
    </li>
  );
}

function QuestionBank({ data }: { data: RunScreenData }) {
  const [category, setCategory] = useState<string | null>(null);
  const filtered = category
    ? data.questions.filter((q) => q.categoryId === category)
    : data.questions;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[15px] font-semibold">Банк вопросов</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={cn(
              "rounded-pill ease-app flex h-7 items-center px-2.5 text-[12px] transition-colors duration-150",
              category === null ? "bg-surface-2 text-text-1" : "text-text-3 hover:text-text-1",
            )}
          >
            Все
          </button>
          {data.categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={cn(
                "rounded-pill ease-app flex h-7 items-center px-2.5 text-[12px] transition-colors duration-150",
                category === cat.id ? "bg-surface-2 text-text-1" : "text-text-3 hover:text-text-1",
              )}
            >
              {cat.title}
            </button>
          ))}
        </div>
        <ul className="divide-border max-h-[60vh] divide-y overflow-y-auto">
          {filtered.map((question) => (
            <QuestionRow key={question.id} bookingId={data.booking.id} question={question} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function RunConducting({ data }: { data: RunScreenData }) {
  const router = useRouter();
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [pending, start] = useTransition();

  const noShow = () =>
    start(async () => {
      const res = await markNoShowAction({ bookingId: data.booking.id });
      if (res.ok) {
        toast({ title: "Отмечена неявка", variant: "success" });
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
      }
    });

  const complete = () =>
    start(async () => {
      const res = await completeMockAction({ bookingId: data.booking.id });
      if (res.ok) {
        toast({ title: "Мок завершён — заполни фидбек", variant: "success" });
        setConfirmComplete(false);
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
        setConfirmComplete(false);
      }
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold">Проведение мока</h1>
          <p className="text-text-2 text-[14px]">
            {MOCK_TYPE_LABEL[data.booking.type]} · {data.student.studentName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isRoomUrlReady(data.booking.roomUrl) ? (
            <Button asChild variant="secondary" size="sm">
              <a href={data.booking.roomUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
                Комната
              </a>
            </Button>
          ) : (
            <Badge variant="warning" title="Укажи ссылку на комнату в расписании">
              Комната не указана
            </Badge>
          )}
          {data.canNoShow && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger"
              loading={pending}
              onClick={noShow}
            >
              Не пришёл
            </Button>
          )}
          <Button size="sm" loading={pending} onClick={() => setConfirmComplete(true)}>
            Завершить мок
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-4">
          <StudentCard student={data.student} />
          <NotesPanel bookingId={data.booking.id} initial={data.booking.notesDraft} />
        </div>
        <QuestionBank data={data} />
      </div>

      <Dialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Завершить мок?</DialogTitle>
            <DialogDescription>
              Ученик получит +200 XP, отметки «частично» и «нет» уйдут в его повторения. Дальше —
              форма фидбека.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmComplete(false)}>
              Назад
            </Button>
            <Button loading={pending} onClick={complete}>
              Завершить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-text-3 text-[13px]">
        <Link href="/interviewer/bookings" className="hover:text-text-1">
          ← К броням
        </Link>
      </p>
    </div>
  );
}
