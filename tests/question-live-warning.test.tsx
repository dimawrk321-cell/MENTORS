import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionEditor } from "@/app/(admin)/admin/questions/[id]/question-editor";
import { LessonQuestions } from "@/app/(admin)/admin/content/lessons/[id]/lesson-questions";

// Заход C.2, блок 2. Проверяется ТЕКСТ предупреждения — то, на что смотрит
// ментор перед публикацией и привязкой. jsdom в проекте нет: рендер
// статический, поэтому здесь нет ни кликов, ни тостов (тост проверяется в
// браузере), только присутствие и формулировка строки.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/actions/questions-admin", () => ({
  deleteQuestionAction: async () => ({ ok: true }),
  removeQuestionLinkAction: async () => ({ ok: true }),
  renderQuestionPreviewAction: async () => ({ ok: true, data: { html: "" } }),
  setQuestionStatusAction: async () => ({ ok: true }),
  updateQuestionAction: async () => ({ ok: true }),
  upsertQuestionLinkAction: async () => ({ ok: true }),
  bulkQuestionLinkRoleAction: async () => ({ ok: true }),
  searchQuestionsAction: async () => ({ ok: true, data: [] }),
  createLessonQuestionAction: async () => ({ ok: true, data: { id: "new" } }),
}));

const QUESTION = {
  id: "q1",
  type: "single" as const,
  status: "draft" as const,
  categoryId: "c1",
  textMd: "пывапып",
  answerMd: "",
  explanationMd: "",
  options: [{ id: "a", text: "Да", correct: true }],
  acceptedAnswers: [] as string[],
  difficulty: 2 as const,
  needsLatex: false,
  source: "manual" as const,
};

function editor(overrides: { status?: "draft" | "published"; liveTestModules?: string[] }): string {
  return renderToStaticMarkup(
    <QuestionEditor
      question={{ ...QUESTION, status: overrides.status ?? "draft" }}
      categories={[{ id: "c1", label: "Classic ML" }]}
      lessons={[{ id: "l1", label: "Деревья решениий" }]}
      links={[]}
      liveTestModules={overrides.liveTestModules ?? []}
    />,
  );
}

describe("предупреждение о боевом пуле в редакторе вопроса (заход C.2)", () => {
  it("черновик: говорит, что публикация ОТПРАВИТ вопрос в боевые попытки, включая экстерн", () => {
    const html = editor({ status: "draft", liveTestModules: ["Classic ML · Основной"] });
    expect(html).toContain("сразу отправит");
    expect(html).toContain("боевые попытки");
    expect(html).toContain("экстерн");
    expect(html).toContain("Classic ML · Основной");
    // Роль не решает — это главное заблуждение, ради него строка и написана.
    expect(html).toContain("Роль привязки на это не влияет");
  });

  it("опубликованный: говорит, что вопрос УЖЕ участвует, и перечисляет модули", () => {
    const html = editor({
      status: "published",
      liveTestModules: ["Classic ML · Основной", "Python + PyTorch · Основной"],
    });
    expect(html).toContain("уже участвует");
    expect(html).not.toContain("сразу отправит");
    expect(html).toContain("Python + PyTorch · Основной");
  });

  it("боевых модулей нет — строки нет вовсе", () => {
    const html = editor({ liveTestModules: [] });
    expect(html).not.toContain("боевые попытки");
    expect(html).not.toContain("уже участвует");
  });
});

describe("секция «Вопросы урока» — счётчик теста не поехал (регресс C.1)", () => {
  it("держит длинный шаг и публикацию черновика отдельными несжимаемыми контролами", () => {
    const longestStep = "Создание модели нейронной сети. Sequential, ModuleList, ModuleDict";
    const html = renderToStaticMarkup(
      <LessonQuestions
        lessonId="l1"
        categories={[{ id: "c1", label: "Classic ML" }]}
        defaultCategoryId="c1"
        defaultCategoryScope="lesson"
        lessonStatus="published"
        moduleTestEnabled
        steps={[{ id: "s1", title: longestStep }]}
        links={[
          {
            questionId: "q1",
            teaser: "Что такое Transformer?",
            category: "Classic ML",
            status: "draft",
            type: "single",
            hasAnswer: true,
            isKey: false,
            inQuiz: true,
            stepId: "s1",
          },
        ]}
      />,
    );

    expect(longestStep).toHaveLength(66);
    expect(html).toMatch(
      /class="[^"]*h-8[^"]*w-44[^"]*shrink-0[^"]*"[^>]*aria-label="Шаг вопроса"/,
    );
    expect(html).toMatch(/class="[^"]*shrink-0[^"]*"[^>]*>Опубликовать<\/button>/);
    expect(html).toContain("[&amp;&gt;span]:truncate");
    expect(html).toContain("Привязано черновиков");
    expect(html).toContain("в модульном тесте");
  });

  it("ведёт из строки сразу в редактор вопроса и сохраняет контекст урока и шага", () => {
    const html = renderToStaticMarkup(
      <LessonQuestions
        lessonId="l1"
        categories={[{ id: "c1", label: "Classic ML" }]}
        defaultCategoryId="c1"
        defaultCategoryScope="lesson"
        lessonStatus="published"
        moduleTestEnabled
        activeStepId="s1"
        steps={[{ id: "s1", title: "Шаг 1" }]}
        links={[
          {
            questionId: "q1",
            teaser: "Что такое Transformer?",
            category: "Classic ML",
            status: "published",
            type: "single",
            hasAnswer: true,
            isKey: false,
            inQuiz: true,
            stepId: "s1",
          },
        ]}
      />,
    );

    expect(html).toContain('href="/admin/questions/q1?fromLesson=l1&amp;fromStep=s1"');
    expect(html).toContain('aria-label="Редактировать вопрос: Что такое Transformer?"');
  });

  it("считает только закрытые опубликованные на опубликованном уроке", () => {
    const html = renderToStaticMarkup(
      <LessonQuestions
        lessonId="l1"
        categories={[{ id: "c1", label: "Classic ML" }]}
        defaultCategoryId="c1"
        defaultCategoryScope="lesson"
        lessonStatus="published"
        moduleTestEnabled
        links={[
          {
            questionId: "q1",
            teaser: "Закрытый",
            category: "Classic ML",
            status: "published",
            type: "single",
            hasAnswer: true,
            isKey: false,
            inQuiz: true,
          },
          {
            questionId: "q2",
            teaser: "Открытый",
            category: "Classic ML",
            status: "published",
            type: "open",
            hasAnswer: true,
            isKey: true,
            inQuiz: false,
          },
        ]}
      />,
    );
    expect(html).toContain("в модульном тесте");
    expect(html).toContain("в тесте");
    expect(html).toContain("Отдельно от роли");
  });

  it("черновой урок: в тест не идёт ничего, и это сказано", () => {
    const html = renderToStaticMarkup(
      <LessonQuestions
        lessonId="l1"
        categories={[{ id: "c1", label: "Classic ML" }]}
        defaultCategoryId="c1"
        defaultCategoryScope="lesson"
        lessonStatus="draft"
        moduleTestEnabled
        links={[
          {
            questionId: "q1",
            teaser: "Закрытый",
            category: "Classic ML",
            status: "published",
            type: "single",
            hasAnswer: true,
            isKey: false,
            inQuiz: true,
          },
        ]}
      />,
    );
    expect(html).toContain("урок в черновике");
  });
});

describe("контекстный возврат из редактора вопроса", () => {
  it("возвращает к блоку вопросов урока вместо общего банка", () => {
    const html = renderToStaticMarkup(
      <QuestionEditor
        question={QUESTION}
        categories={[{ id: "c1", label: "Classic ML" }]}
        lessons={[{ id: "l1", label: "Деревья решений" }]}
        links={[]}
        liveTestModules={[]}
        backHref="/admin/content/lessons/l1?step=s1#lesson-questions"
        backLabel="К вопросам урока"
      />,
    );

    expect(html).toContain('href="/admin/content/lessons/l1?step=s1#lesson-questions"');
    expect(html).toContain("К вопросам урока");
  });
});
