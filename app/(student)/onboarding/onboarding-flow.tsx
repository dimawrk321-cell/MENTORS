"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Track } from "@prisma/client";
import { Brain, MessageSquareText, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { saveOnboardingAction } from "@/lib/actions/content";

const TRACKS = [
  {
    value: "ds" as Track,
    title: "Data Science",
    description: "Классический ML, метрики, продакшен",
    icon: Workflow,
  },
  {
    value: "nlp" as Track,
    title: "NLP",
    description: "Языковые модели и трансформеры",
    icon: MessageSquareText,
  },
  {
    value: "ai" as Track,
    title: "AI Engineering",
    description: "LLM-продукты и инфраструктура",
    icon: Brain,
  },
];

const GOALS = [
  { value: 30 as const, title: "Лайт", description: "~15 минут в день" },
  { value: 60 as const, title: "Норма", description: "~30 минут в день" },
  { value: 120 as const, title: "Интенсив", description: "~60 минут в день" },
];

interface OnboardingFlowProps {
  initialTrack: Track | null;
  initialGoal: 30 | 60 | 120;
  initialDigestTime: string;
}

export function OnboardingFlow({
  initialTrack,
  initialGoal,
  initialDigestTime,
}: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const [track, setTrack] = useState<Track | null>(initialTrack);
  const [goal, setGoal] = useState<30 | 60 | 120>(initialGoal);
  const [digestTime, setDigestTime] = useState(initialDigestTime);
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [pending, startTransition] = useTransition();

  function finish(): void {
    startTransition(async () => {
      // DECISION: the digest toggle is UI-only until stage 9 wires
      // notification_prefs — no digests are sent before that anyway.
      const result = await saveOnboardingAction({ track, dailyGoalXp: goal, digestTime });
      if (result && !result.ok) {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  const steps = [
    {
      title: "Какая цель?",
      description: "Определит порядок курсов и первый урок.",
      body: (
        <div className="flex flex-col gap-2">
          {TRACKS.map((option) => {
            const Icon = option.icon;
            const active = track === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTrack(option.value)}
                aria-pressed={active}
                className={cn(
                  "rounded-card ease-app flex items-center gap-3 border p-4 text-left transition-colors duration-150",
                  active ? "border-accent bg-accent/6" : "border-border hover:border-border-strong",
                )}
              >
                <Icon
                  size={20}
                  strokeWidth={1.75}
                  className={active ? "text-accent" : "text-text-3"}
                  aria-hidden="true"
                />
                <span>
                  <span className="block text-[14px] font-medium">{option.title}</span>
                  <span className="text-text-2 block text-[13px]">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      ),
      canNext: track !== null,
    },
    {
      title: "Сколько времени в день?",
      description: "Настроит дневную цель — поменять можно в профиле.",
      body: (
        <div className="flex flex-col gap-2">
          {GOALS.map((option) => {
            const active = goal === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setGoal(option.value)}
                aria-pressed={active}
                className={cn(
                  "rounded-card ease-app flex items-baseline justify-between gap-3 border p-4 text-left transition-colors duration-150",
                  active ? "border-accent bg-accent/6" : "border-border hover:border-border-strong",
                )}
              >
                <span className="text-[14px] font-medium">{option.title}</span>
                <span className="text-text-2 text-[13px]">{option.description}</span>
              </button>
            );
          })}
        </div>
      ),
      canNext: true,
    },
    {
      title: "Напоминания",
      description: "Утренний дайджест с карточками к повторению.",
      body: (
        <div className="flex flex-col gap-4">
          <label className="flex items-center justify-between gap-3 text-[14px]">
            Присылать дайджест
            <Switch checked={digestEnabled} onCheckedChange={setDigestEnabled} />
          </label>
          {digestEnabled && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="digest-time" className="text-text-2 text-[13px]">
                Время дайджеста
              </label>
              <Input
                id="digest-time"
                type="time"
                value={digestTime}
                onChange={(event) => setDigestTime(event.target.value)}
                className="max-w-[140px]"
              />
            </div>
          )}
        </div>
      ),
      canNext: true,
    },
  ];

  const current = steps[step]!;
  const last = step === steps.length - 1;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        {/* Progress dots (spec 8.2) */}
        <div
          className="flex justify-center gap-1.5"
          aria-label={`Шаг ${step + 1} из ${steps.length}`}
        >
          {steps.map((_, index) => (
            <span
              key={index}
              className={cn(
                "rounded-pill ease-app size-1.5 transition-colors duration-150",
                index === step ? "bg-accent" : "bg-border-strong",
              )}
            />
          ))}
        </div>

        <div>
          <h1 className="text-center text-[24px] font-semibold">{current.title}</h1>
          <p className="text-text-2 mt-1 text-center text-[14px]">{current.description}</p>
        </div>

        {current.body}

        <div className="flex items-center justify-between gap-3">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Назад
            </Button>
          ) : (
            <Link
              href="/"
              className="text-text-3 ease-app hover:text-text-1 px-2 text-[13px] transition-colors duration-150"
            >
              Пропустить
            </Link>
          )}
          {last ? (
            <Button loading={pending} onClick={finish}>
              Начать обучение
            </Button>
          ) : (
            <Button disabled={!current.canNext} onClick={() => setStep(step + 1)}>
              Далее
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
