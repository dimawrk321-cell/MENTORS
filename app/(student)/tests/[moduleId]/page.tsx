import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, CircleOff, Trophy, X } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireStudentZone } from "@/lib/auth/guards";
import { getCourseView } from "@/lib/services/content";
import {
  getAttemptForRunner,
  getAttemptReview,
  getTestOverview,
  TESTOUT_THRESHOLD,
} from "@/lib/services/tests";
import { parseOptions } from "@/lib/utils/answers";
import { seededShuffle } from "@/lib/utils/shuffle";
import { LessonRenderer } from "@/components/blocks/lesson-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { TestRunner, type RunnerQuestion } from "./test-runner";
import { StartTestButton } from "./test-controls";

export const metadata: Metadata = {
  title: "Модульный тест",
};

interface TestPageProps {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{ kind?: string }>;
}

function formatAnswer(question: { options: unknown; type: string }, answer: unknown): string {
  if (answer === null || answer === undefined) return "— (без ответа)";
  const options = parseOptions(question.options);
  const byId = new Map(options.map((option) => [option.id, option.text]));
  if (typeof answer === "string") return byId.get(answer) ?? answer;
  if (Array.isArray(answer)) {
    return answer.map((id) => byId.get(String(id)) ?? String(id)).join("; ") || "— (без ответа)";
  }
  return String(answer);
}

/** /tests/[moduleId] (spec 8.3): интро → TestRunner → результат (7.5). */
export default async function TestPage({ params, searchParams }: TestPageProps) {
  const { user } = await requireStudentZone();
  const { moduleId } = await params;
  const { kind: kindParam } = await searchParams;

  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { course: { select: { slug: true, title: true, gating: true, status: true } } },
  });
  if (!mod || mod.status !== "published" || mod.course.status !== "published") notFound();

  const courseView = await getCourseView(prisma, mod.course.slug, user.id);
  const moduleState = courseView?.state.modules.get(mod.id);
  if (!moduleState) notFound();

  const overview = await getTestOverview(prisma, { userId: user.id, moduleId: mod.id });

  const backLink = (
    <Link
      href={`/courses/${mod.course.slug}`}
      className="text-text-3 ease-app hover:text-text-1 flex w-fit items-center gap-1.5 text-[13px] transition-colors duration-150"
    >
      <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
      {mod.course.title}
    </Link>
  );

  if (!overview || !overview.test.enabled) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Card className="mx-auto w-full max-w-xl">
          <EmptyState
            icon={CircleOff}
            title="У этого модуля нет теста"
            description="Модуль закрывается завершением уроков."
            action={
              <Button asChild variant="secondary">
                <Link href={`/courses/${mod.course.slug}`}>К курсу</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const lessonsDone = moduleState.completedRequired === moduleState.totalRequired;

  // --- 1) Активная попытка: раннер (обновление страницы не теряет прогресс) ---
  if (overview.activeAttempt) {
    const runner = await getAttemptForRunner(prisma, {
      attemptId: overview.activeAttempt.id,
      userId: user.id,
    });
    if (runner) {
      const questions: RunnerQuestion[] = runner.questions.map((question) => ({
        id: question.id,
        type: question.type,
        questionNode: <LessonRenderer markdown={question.textMd} />,
        // Варианты перемешаны стабильно в рамках попытки (spec 7.5).
        options: seededShuffle(
          parseOptions(question.options),
          `${runner.attempt.id}:${question.id}`,
        ).map((option) => ({ id: option.id, text: option.text })),
      }));
      return (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {backLink}
            <Badge>
              {runner.attempt.kind === "testout"
                ? "Экстерн · порог 90%"
                : `порог ${overview.test.threshold}%`}
            </Badge>
          </div>
          <h1 className="text-center text-[24px] font-semibold">
            {runner.attempt.kind === "testout" ? "Экстерн: " : "Тест: "}
            {mod.title}
          </h1>
          <TestRunner
            attemptId={runner.attempt.id}
            questions={questions}
            answeredIds={[...runner.answeredIds]}
          />
        </div>
      );
    }
  }

  // --- 2) Сдан: сдержанное поздравление + полный разбор (spec 7.5) ---
  if (overview.passedAttemptId) {
    const review = await getAttemptReview(prisma, {
      attemptId: overview.passedAttemptId,
      userId: user.id,
    });
    if (!review) notFound();
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {backLink}
        <div className="text-center">
          <Trophy
            size={28}
            strokeWidth={1.5}
            className="text-success mx-auto mb-2"
            aria-hidden="true"
          />
          <h1 className="text-[24px] font-semibold">
            {review.attempt.kind === "testout" ? "Модуль зачтён экстерном" : "Тест сдан"} —{" "}
            {review.attempt.score}%
          </h1>
          <p className="text-text-2 mt-1 text-[14px]">
            {mod.title} · порог {review.threshold}%
          </p>
        </div>

        <h2 className="text-[18px] font-semibold">Разбор вопросов</h2>
        <div className="flex flex-col gap-3">
          {review.review?.map(({ question, answer, correct }, index) => {
            const correctOptions = parseOptions(question.options).filter(
              (option) => option.correct,
            );
            return (
              <Card
                key={question.id}
                className={cn(correct ? "border-success/40" : "border-danger/40")}
              >
                <CardContent className="p-4">
                  <p className="text-text-3 mb-2 flex items-center gap-2 text-[12px]">
                    {correct ? (
                      <Check
                        size={14}
                        strokeWidth={2.25}
                        className="text-success"
                        aria-hidden="true"
                      />
                    ) : (
                      <X size={14} strokeWidth={2.25} className="text-danger" aria-hidden="true" />
                    )}
                    Вопрос {index + 1}
                  </p>
                  <div className="lesson-prose mb-3 text-[15px] font-medium">
                    <LessonRenderer markdown={question.textMd} />
                  </div>
                  <div className="flex flex-col gap-1 text-[14px]">
                    <p>
                      <span className="text-text-3">Твой ответ: </span>
                      <span className={correct ? "text-success" : "text-danger"}>
                        {formatAnswer(question, answer)}
                      </span>
                    </p>
                    {!correct && question.type !== "short_text" && correctOptions.length > 0 && (
                      <p>
                        <span className="text-text-3">Правильный: </span>
                        {correctOptions.map((option) => option.text).join("; ")}
                      </p>
                    )}
                  </div>
                  {question.explanationMd?.trim() && (
                    <div className="lesson-prose border-border text-text-2 mt-3 border-t pt-3 text-[14px]">
                      <LessonRenderer markdown={question.explanationMd} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div className="flex justify-center">
          <Button asChild>
            <Link href={`/courses/${mod.course.slug}`}>Продолжить курс</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Какой вид сдачи актуален сейчас (spec 7.3): уроки пройдены → обычный тест;
  // strict-модуль с непройденными уроками → экстерн.
  const activeKind: "module" | "testout" = lessonsDone
    ? "module"
    : mod.course.gating === "strict"
      ? "testout"
      : "module";
  const threshold = activeKind === "testout" ? TESTOUT_THRESHOLD : overview.test.threshold;
  const cooldownUntil = overview.cooldownUntil[activeKind]?.toISOString() ?? null;

  // --- 3) Последняя попытка провалена: счёт, темы, кулдаун-кнопка ---
  if (overview.lastFailed) {
    const review = await getAttemptReview(prisma, {
      attemptId: overview.lastFailed.id,
      userId: user.id,
    });
    if (!lessonsDone && mod.course.gating !== "strict") {
      // free/recommended без завершённых уроков — сдавать пока нечего.
    }
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
        {backLink}
        <div className="text-center">
          <h1 className="text-[32px] font-semibold">
            {overview.lastFailed.score}%{" "}
            <span className="text-text-2 text-[18px] font-medium">
              — нужно {review?.threshold ?? threshold}%
            </span>
          </h1>
          <p className="text-text-2 mt-1 text-[14px]">
            {mod.title}. Правильные ответы откроются после успешной сдачи — новая попытка будет с
            новой выборкой вопросов.
          </p>
        </div>
        {review && review.failedTopics.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-text-2 mb-2 text-[13px]">Темы, где были ошибки:</p>
              <div className="flex flex-wrap gap-1.5">
                {review.failedTopics.map((topic) => (
                  <Badge key={topic} variant="warning">
                    {topic}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {(lessonsDone || mod.course.gating === "strict") && (
          <div className="flex justify-center">
            <StartTestButton
              moduleId={mod.id}
              kind={activeKind}
              cooldownUntil={cooldownUntil}
              label={activeKind === "testout" ? "Пересдать экстерном" : "Пересдать"}
            />
          </div>
        )}
      </div>
    );
  }

  // --- 4) Интро с правилами (spec 8.3) ---
  const testoutIntro = activeKind === "testout";
  if (!lessonsDone && !testoutIntro) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Card className="mx-auto w-full max-w-xl">
          <EmptyState
            icon={CircleOff}
            title="Тест пока закрыт"
            description="Сначала заверши уроки модуля."
            action={
              <Button asChild variant="secondary">
                <Link href={`/courses/${mod.course.slug}`}>К курсу</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      {backLink}
      <div className="text-center">
        <h1 className="text-[24px] font-semibold">
          {testoutIntro ? "Сдать модуль экстерном" : "Модульный тест"}
        </h1>
        <p className="text-text-2 mt-1 text-[15px]">{mod.title}</p>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-2.5 p-5 text-[14px]">
          <div className="flex justify-between gap-4">
            <span className="text-text-2">Вопросов</span>
            <span>{overview.attemptSize}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-text-2">Порог сдачи</span>
            <span>{threshold}%</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-text-2">Пересдача после провала</span>
            <span>через {overview.test.cooldownMinutes} мин, новая выборка</span>
          </div>
          <p className="border-border text-text-3 border-t pt-2.5 text-[13px]">
            Без таймера. Правильные ответы в провале не показываются; после успешной сдачи — полный
            разбор.
            {testoutIntro &&
              " Успех зачтёт все уроки модуля; вернуться к ним можно в любой момент."}
          </p>
        </CardContent>
      </Card>
      {kindParam === "testout" && lessonsDone && (
        <p className="text-text-3 text-center text-[13px]">
          Уроки модуля уже пройдены — сдаётся обычный модульный тест.
        </p>
      )}
      {overview.poolCount === 0 ? (
        <p className="text-text-2 text-center text-[14px]">
          В модуле пока нет вопросов для теста — загляни позже.
        </p>
      ) : (
        <div className="flex justify-center">
          <StartTestButton
            moduleId={mod.id}
            kind={activeKind}
            cooldownUntil={cooldownUntil}
            label={testoutIntro ? "Начать экстерн" : "Начать тест"}
          />
        </div>
      )}
    </div>
  );
}
