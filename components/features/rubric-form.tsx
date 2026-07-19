"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FeedbackFormData } from "@/lib/services/feedback";
import { MOCK_VERDICT_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publishFeedbackAction, saveFeedbackDraftAction } from "@/lib/actions/interviewer";

type Verdict = "ready" | "needs_work" | "not_ready";

const VERDICTS: Verdict[] = ["ready", "needs_work", "not_ready"];

interface RubricFormProps {
  bookingId: string;
  form: FeedbackFormData;
}

// RubricForm (spec 5.3/7.8): критерии 1–5, вердикт, тексты, рекомендованные уроки,
// автосейв черновика. «Опубликовать» шлёт ученику уведомление и открывает фидбек.
export function RubricForm({ bookingId, form }: RubricFormProps) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>(form.draft?.scores ?? {});
  const [verdict, setVerdict] = useState<Verdict>(form.draft?.verdict ?? "needs_work");
  const [strengths, setStrengths] = useState(form.draft?.strengths ?? "");
  const [growth, setGrowth] = useState(form.draft?.growth ?? "");
  const [lessonIds, setLessonIds] = useState<Set<string>>(
    new Set(form.draft?.recommendedLessonIds ?? []),
  );
  const [saved, setSaved] = useState(true);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const payload = () => ({
    bookingId,
    scores,
    verdict,
    strengths,
    growth,
    recommendedLessonIds: [...lessonIds],
  });

  const scheduleSave = () => {
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await saveFeedbackDraftAction(payload());
      if (res.ok) setSaved(true);
    }, 800);
  };

  const setScore = (key: string, value: number) => {
    setScores((prev) => ({ ...prev, [key]: value }));
    scheduleSave();
  };

  const toggleLesson = (id: string) => {
    setLessonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    scheduleSave();
  };

  const lessonsByCourse = useMemo(() => {
    const map = new Map<string, FeedbackFormData["lessons"]>();
    for (const lesson of form.lessons) {
      const list = map.get(lesson.courseTitle) ?? [];
      list.push(lesson);
      map.set(lesson.courseTitle, list);
    }
    return [...map.entries()];
  }, [form.lessons]);

  const publish = () =>
    start(async () => {
      // Сначала фиксируем черновик, затем публикуем (публикация берёт сохранённое).
      const draft = await saveFeedbackDraftAction(payload());
      if (!draft.ok) {
        toast({ title: draft.error.message, variant: "danger" });
        return;
      }
      const res = await publishFeedbackAction({ bookingId });
      if (res.ok) {
        toast({ title: "Фидбек опубликован", variant: "success" });
        setConfirmPublish(false);
        router.refresh();
      } else {
        toast({ title: res.error.message, variant: "danger" });
        setConfirmPublish(false);
      }
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-semibold">Фидбек</h1>
        <span aria-live="polite" className="text-text-3 text-[12px]">
          {saved ? "Черновик сохранён" : "Сохраняем…"}
        </span>
      </div>

      {/* Критерии 1–5 (spec 7.8) */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-text-3 text-[12px]">Оценки по критериям</p>
          {form.criteria.map((criterion) => (
            <div key={criterion.key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[14px]">{criterion.title}</span>
              <div className="flex gap-1" role="group" aria-label={criterion.title}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setScore(criterion.key, value)}
                    aria-pressed={scores[criterion.key] === value}
                    className={cn(
                      "rounded-control border-border ease-app size-8 border text-[13px] tabular-nums transition-colors duration-150",
                      scores[criterion.key] === value
                        ? "bg-accent border-accent text-white"
                        : "text-text-2 hover:border-border-strong",
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Вердикт (spec 7.8) */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <p className="text-text-3 text-[12px]">Вердикт</p>
          <div className="flex flex-wrap gap-2">
            {VERDICTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setVerdict(v);
                  scheduleSave();
                }}
                aria-pressed={verdict === v}
                className={cn(
                  "rounded-control border-border ease-app h-9 border px-3 text-[14px] transition-colors duration-150",
                  verdict === v
                    ? "bg-accent border-accent text-white"
                    : "text-text-2 hover:border-border-strong",
                )}
              >
                {MOCK_VERDICT_LABEL[v]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Тексты (spec 7.8) */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-1.5">
            <p className="text-text-3 text-[12px]">Сильные стороны</p>
            <textarea
              value={strengths}
              onChange={(e) => {
                setStrengths(e.target.value);
                scheduleSave();
              }}
              rows={5}
              className="rounded-control border-border text-text-1 ease-app hover:border-border-strong w-full resize-y border bg-transparent px-3 py-2 text-[14px] transition-colors duration-150"
              aria-label="Сильные стороны"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1.5">
            <p className="text-text-3 text-[12px]">Зоны роста</p>
            <textarea
              value={growth}
              onChange={(e) => {
                setGrowth(e.target.value);
                scheduleSave();
              }}
              rows={5}
              className="rounded-control border-border text-text-1 ease-app hover:border-border-strong w-full resize-y border bg-transparent px-3 py-2 text-[14px] transition-colors duration-150"
              aria-label="Зоны роста"
            />
          </CardContent>
        </Card>
      </div>

      {/* Рекомендованные уроки (spec 7.8) */}
      <Card>
        <CardContent className="flex flex-col gap-2">
          <p className="text-text-3 text-[12px]">Рекомендованные уроки</p>
          {form.lessons.length === 0 ? (
            <p className="text-text-2 text-[13px]">Опубликованных уроков пока нет.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {lessonsByCourse.map(([courseTitle, lessons]) => (
                <div key={courseTitle} className="mb-2">
                  <p className="text-text-3 mb-1 text-[12px]">{courseTitle}</p>
                  <div className="flex flex-col gap-1">
                    {lessons.map((lesson) => (
                      <label key={lesson.id} className="flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          checked={lessonIds.has(lesson.id)}
                          onChange={() => toggleLesson(lesson.id)}
                          className="accent-accent size-4"
                        />
                        {lesson.title}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button loading={pending} onClick={() => setConfirmPublish(true)}>
          Опубликовать фидбек
        </Button>
        <span className="text-text-3 text-[13px]">
          До публикации ученик видит статус «Ожидает фидбека».
        </span>
      </div>

      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Опубликовать фидбек?</DialogTitle>
            <DialogDescription>
              Ученик получит уведомление и увидит оценки, вердикт и рекомендации. После публикации
              правки будут недоступны.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmPublish(false)}>
              Назад
            </Button>
            <Button loading={pending} onClick={publish}>
              Опубликовать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
