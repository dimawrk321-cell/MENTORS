"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  EyeOff,
  Maximize2,
  Minimize2,
  Save,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { BackButton } from "@/components/ui/back-button";
import { cn } from "@/lib/utils/cn";
import { RECORDING_NOTICE_TEXT, RECORDING_NOTICE_TITLE } from "@/lib/constants";
import { lessonDurationLabel } from "@/lib/utils/lesson-path";
import { isPlayableVideoUrl, videoLinkHost } from "@/lib/utils/youtube";
import { applySnippet } from "@/lib/utils/editor-insert";
import { snippetsFor, type SnippetDef } from "@/lib/content/editor-snippets";
import { BlockEditor } from "@/components/features/block-editor";
import { QuestionBankPicker } from "@/components/features/question-bank-picker";
import {
  saveLessonContentAction,
  setLessonStatusAction,
  updateLessonMetaAction,
} from "@/lib/actions/content-admin";

interface EditorLesson {
  id: string;
  title: string;
  slug: string;
  contentMd: string;
  videoUrl: string;
  difficulty: "intro" | "base" | "advanced";
  isOptional: boolean;
  status: "draft" | "published";
  readingMinutes: number;
  pathPolicy: "combined" | "choose_one" | "video_only" | "text_only";
  textMinutes: number | null;
  videoMinutes: number | null;
  practiceMinutes: number | null;
}

const DIFFICULTY_OPTIONS = [
  { value: "intro", label: "Интро" },
  { value: "base", label: "База" },
  { value: "advanced", label: "Продвинутый" },
] as const;

const PATH_POLICY_OPTIONS = [
  { value: "combined", label: "Видео и текст подряд" },
  { value: "choose_one", label: "Видео или текст на выбор" },
  { value: "video_only", label: "Только видео" },
  { value: "text_only", label: "Только текст" },
] as const;

const DURATION_FIELDS = [
  { key: "textMinutes", label: "Текст, мин", placeholder: "Автооценка" },
  { key: "videoMinutes", label: "Видео, мин", placeholder: "Не указано" },
  { key: "practiceMinutes", label: "Практика, мин", placeholder: "Не указано" },
] as const;

// Directive insert panel (spec 8.5 / 12.1-C10): grouped, human names + hints.
// D5 (spec 13.1): `%s` in a snippet marks where the current selection is wrapped
// (or `placeholder` when nothing is selected) and then re-selected — so clicking a
// directive with text selected wraps it instead of discarding it.
const SNIPPETS: SnippetDef[] = snippetsFor("lesson");

const SNIPPET_GROUPS = ["Врезки", "Медиа", "Блоки"];

// Inline marks that wrap the current selection (spec 12.1/C10 extra).
const INLINE_MARKS: { label: string; title: string; before: string; after: string }[] = [
  { label: "Ж", title: "Полужирный", before: "**", after: "**" },
  { label: "код", title: "Инлайн-код", before: "`", after: "`" },
  { label: "$…$", title: "Инлайн-формула", before: "$", after: "$" },
];

const AUTOSAVE_MS = 1000;

/**
 * Live preview = the student render by construction: the right pane is an iframe of
 * /content-preview/[id] refreshed after each debounced autosave — one render path,
 * zero drift (spec 8.5). Studio conveniences (spec 12.1/C10): fullscreen, Ctrl/Cmd+S,
 * directive panel, breadcrumbs, prominent «Открыть как ученика», inline marks, word
 * count, copy-preview-link.
 */
export function LessonEditor({
  lesson,
  courseTitle,
  moduleTitle,
}: {
  lesson: EditorLesson;
  courseTitle: string;
  moduleTitle: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState(lesson.contentMd);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [previewVersion, setPreviewVersion] = useState(0);
  const [readingMinutes, setReadingMinutes] = useState(lesson.readingMinutes);
  const [fullscreen, setFullscreen] = useState(false);
  const [pickingQuestion, setPickingQuestion] = useState(false);
  // Walk 13.6 rail 1: the block editor is offered ONLY when segmentation is
  // provably lossless for this exact document. Computed once from the stored
  // markdown; a document that fails opens in plain text mode instead of having
  // its bytes silently rewritten.
  const [mode, setMode] = useState<"blocks" | "text">("blocks");
  const [meta, setMeta] = useState({
    title: lesson.title,
    slug: lesson.slug,
    videoUrl: lesson.videoUrl,
    difficulty: lesson.difficulty as string,
    isOptional: lesson.isOptional,
    pathPolicy: lesson.pathPolicy as string,
    textMinutes: lesson.textMinutes ?? "",
    videoMinutes: lesson.videoMinutes ?? "",
    practiceMinutes: lesson.practiceMinutes ?? "",
  });
  const [pending, startTransition] = useTransition();
  // Заход C.4: последствие санитайзера записей (ссылка на Я.Диск рядом с паролем
  // или контекстом «запись собеседования») — сохранено, но ученик увидит врезку
  // про Библиотеку вместо ссылки.
  const [recordingNotice, setRecordingNotice] = useState(false);
  const noticeShown = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContent = useRef(content);

  const wordCount = useMemo(
    () => (content.trim() ? content.trim().split(/\s+/).length : 0),
    [content],
  );

  // Ровно та строка, что стоит чипом на странице урока, — считается тем же
  // `lessonDurationLabel`, второй формулы длительности нет (заход B.2, 3.2).
  const durationPreview = useMemo(
    () =>
      lessonDurationLabel({
        readingMinutes,
        textMinutes: meta.textMinutes === "" ? null : Number(meta.textMinutes),
        videoMinutes: meta.videoMinutes === "" ? null : Number(meta.videoMinutes),
        practiceMinutes: meta.practiceMinutes === "" ? null : Number(meta.practiceMinutes),
        pathPolicy: meta.pathPolicy as EditorLesson["pathPolicy"],
        hasVideo: meta.videoUrl.trim().length > 0,
        videoPlayable: isPlayableVideoUrl(meta.videoUrl.trim()),
      }),
    [
      readingMinutes,
      meta.textMinutes,
      meta.videoMinutes,
      meta.practiceMinutes,
      meta.pathPolicy,
      meta.videoUrl,
    ],
  );

  const flushSave = useCallback((): Promise<boolean> => {
    saveTimer.current = null;
    setSaveState("saving");
    return saveLessonContentAction(lesson.id, latestContent.current).then((result) => {
      if (result?.ok) {
        setReadingMinutes(result.data.readingMinutes);
        setSaveState("saved");
        setPreviewVersion((version) => version + 1);
        // Заход C.4: тост — один раз на переходе «не было → появилось», а не на
        // каждом автосейве (он идёт каждые несколько секунд и встал бы стеной
        // поверх редактора). Признак живёт в рефе, а не в апдейтере состояния:
        // апдейтер React вправе вызвать дважды, и тост бы задвоился.
        if (result.data.recordingNotice && !noticeShown.current) {
          toast({
            title: RECORDING_NOTICE_TITLE,
            description: RECORDING_NOTICE_TEXT,
            variant: "warning",
          });
        }
        noticeShown.current = result.data.recordingNotice;
        setRecordingNotice(result.data.recordingNotice);
        return true;
      }
      setSaveState("dirty");
      if (result) toast({ title: result.error.message, variant: "danger" });
      return false;
    });
  }, [lesson.id]);

  function onContentChange(value: string): void {
    setContent(value);
    latestContent.current = value;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, AUTOSAVE_MS);
  }

  // Flush a pending save when leaving the editor.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        flushSave();
      }
    };
  }, [flushSave]);

  // Ctrl/Cmd+S saves with a toast; Escape exits fullscreen (spec 12.1/C10).
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void flushSave().then((ok) => {
          if (ok) toast({ title: "Сохранено", variant: "success" });
        });
      } else if (event.key === "Escape" && fullscreen) {
        setFullscreen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flushSave, fullscreen]);

  // D5 (spec 13.1): directive insert wraps the current selection (applySnippet)
  // instead of discarding it, then re-selects the wrapped body / placeholder.
  function insertSnippet(def: SnippetDef): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const res = applySnippet(content, textarea.selectionStart, textarea.selectionEnd, def);
    onContentChange(res.content);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(res.selectionStart, res.selectionEnd);
    });
  }

  /** Заход B.1: выбранный в диалоге вопрос становится директивой в тексте. */
  function insertQuestion(questionId: string): void {
    insertSnippet({
      snippet: `\n:::question{id="${questionId}"}\n:::\n`,
      placeholder: "",
      group: "Блоки",
      label: "Вопрос из банка",
      hint: "",
    });
  }

  // Wraps the selected lines in a :::callout{type=material} block (walk 12.3, P3d):
  // the fast path for turning a pasted list of source links into a materials card.
  function wrapLinesInMaterial(): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const value = content;
    const lineStart = value.lastIndexOf("\n", textarea.selectionStart - 1) + 1;
    let lineEnd = value.indexOf("\n", textarea.selectionEnd);
    if (lineEnd === -1) lineEnd = value.length;
    const block = value.slice(lineStart, lineEnd).trim();
    if (!block) {
      toast({ title: "Выдели строки со ссылками", variant: "danger" });
      return;
    }
    const before = value.slice(0, lineStart);
    const after = value.slice(lineEnd);
    const lead =
      before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trail = after === "" || after.startsWith("\n") ? "" : "\n";
    const wrapped = `:::callout{type="material"}\n${block}\n:::`;
    const next = before + lead + wrapped + trail + after;
    onContentChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = (before + lead + wrapped).length;
    });
  }

  function wrapSelection(before: string, after: string): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end);
    const next = content.slice(0, start) + before + selected + after + content.slice(end);
    onContentChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = end + before.length;
    });
  }

  // Tab inserts two spaces (markdown/code editing); Escape blurs so keyboard users
  // are never trapped in the textarea (spec 14).
  function onEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Tab") {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = content.slice(0, start) + "  " + content.slice(end);
      onContentChange(next);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    } else if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }

  function copyPreviewLink(): void {
    const url = `${window.location.origin}/content-preview/${lesson.id}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: "Ссылка на превью скопирована", variant: "success" }))
      .catch(() => toast({ title: "Не удалось скопировать", variant: "danger" }));
  }

  function saveMeta(): void {
    startTransition(async () => {
      const result = await updateLessonMetaAction({ lessonId: lesson.id, ...meta });
      if (!result) return;
      if (result.ok) {
        toast({ title: "Метаданные сохранены", variant: "success" });
        router.refresh();
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  function togglePublish(): void {
    const target = lesson.status === "published" ? "draft" : "published";
    startTransition(async () => {
      const result = await setLessonStatusAction(lesson.id, target);
      if (!result) return;
      if (result.ok) {
        toast({
          title: target === "published" ? "Урок опубликован" : "Урок снят с публикации",
          variant: "success",
        });
        router.refresh();
      } else {
        toast({ title: result.error.message, variant: "danger" });
      }
    });
  }

  const saveLabel =
    saveState === "saved" ? "Сохранено" : saveState === "saving" ? "Сохранение…" : "Изменено…";

  return (
    // `data-admin-wide` (заход B.6): двухпанельный редактор просит у админ-шелла
    // широкий контейнер — иначе на 1600px он держал 1024 из доступных 1296, и
    // предпросмотру не хватало на читальную колонку 680px. Потолок — в
    // app/(admin)/admin/layout.tsx, ниже 1024px он не участвует.
    <div
      data-admin-wide
      className={cn(
        "flex flex-col gap-4",
        fullscreen && "bg-bg fixed inset-0 z-50 overflow-auto p-4",
      )}
    >
      {/* Breadcrumbs (spec 12.1/C10) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <BackButton href="/admin/content" label="Контент" className="w-auto" />
        <Crumb>{courseTitle}</Crumb>
        <Crumb>{moduleTitle}</Crumb>
        <ChevronRight size={13} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
        {/* The page title IS the lesson name. Kept at the breadcrumb size the
            design prescribes — only the element changes, so the screen has an
            h1 instead of a section h2 being its largest heading. */}
        <h1 className="text-text-1 max-w-[220px] truncate text-[13px] font-medium">{meta.title}</h1>
      </div>

      {/* Панель действий (заход B.2, блок 3.1). Жалоба ментора: «непонятно, как
          опубликовать». Раньше всё стояло одной строкой с крошками, «Опубликовать»
          было secondary, а самой заметной кнопкой — «Открыть как ученика», то
          есть просмотр. Теперь: слева состояние урока словами (что видит ученик),
          справа два главных действия — сохранить и опубликовать; просмотр,
          копирование ссылки и полный экран ушли во второй план. */}
      <div className="rounded-card border-border bg-surface-1 flex flex-wrap items-center gap-x-3 gap-y-2 border p-3">
        <span
          className={cn(
            "rounded-pill inline-flex items-center gap-1.5 px-3 py-[5px] text-[13px] font-medium",
            lesson.status === "published"
              ? "bg-success/12 text-success"
              : "bg-warning/12 text-warning",
          )}
        >
          {lesson.status === "published" ? (
            <Check size={14} strokeWidth={2} aria-hidden="true" />
          ) : (
            <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
          {lesson.status === "published" ? "Опубликован" : "Черновик"}
        </span>
        <span className="text-text-3 text-[12px]">
          {lesson.status === "published"
            ? "Ученики видят этот урок"
            : "Ученики его не видят — опубликуй, когда будет готов"}
        </span>

        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-text-3 text-[12px] tabular-nums" aria-live="polite">
            {saveLabel}
          </span>
          {/* Автосейв остаётся, но кнопка нужна: без неё ментор не знает, что
              урок вообще сохраняется, и ищет «Сохранить» глазами. */}
          <Button
            variant="secondary"
            size="sm"
            loading={saveState === "saving"}
            disabled={saveState === "saved"}
            onClick={() => void flushSave()}
          >
            <Save size={14} strokeWidth={1.75} aria-hidden="true" />
            {saveState === "saved" ? "Сохранено" : "Сохранить"}
          </Button>
          <Button
            variant={lesson.status === "published" ? "secondary" : "gradient"}
            size="sm"
            loading={pending}
            onClick={togglePublish}
          >
            {lesson.status === "published" ? "Снять с публикации" : "Опубликовать"}
          </Button>
        </span>
      </div>

      {/* Заход C.4: последствие санитайзера записей висит на экране, пока текст
          не поправлен, — тост уходит через несколько секунд, а факт остаётся. */}
      {recordingNotice ? (
        <div className="rounded-card border-warning/40 bg-warning/8 text-warning flex items-start gap-2 border px-3 py-2.5 text-[13px]">
          <ShieldAlert
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          />
          <span>
            <strong className="font-medium">{RECORDING_NOTICE_TITLE}.</strong>{" "}
            {RECORDING_NOTICE_TEXT}
          </span>
        </div>
      ) : null}

      {/* Второстепенное: просмотр, ссылка, полный экран. */}
      <div className="text-text-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="tabular-nums">
          {readingMinutes} мин · {wordCount} сл.
        </span>
        {/* DECISION: студенческая зона закрыта для mentor+, поэтому «Открыть как
            ученика» открывает полностраничный превью-рендер (тот же LessonRenderer). */}
        <a
          href={`/content-preview/${lesson.id}`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-text-1 ease-app inline-flex items-center gap-1.5 transition-colors duration-150"
        >
          <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
          Открыть как ученика
        </a>
        <button
          type="button"
          onClick={copyPreviewLink}
          className="hover:text-text-1 ease-app inline-flex items-center gap-1.5 transition-colors duration-150"
        >
          <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
          Скопировать ссылку
        </button>
        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          className="hover:text-text-1 ease-app inline-flex items-center gap-1.5 transition-colors duration-150"
        >
          {fullscreen ? (
            <Minimize2 size={13} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Maximize2 size={13} strokeWidth={1.75} aria-hidden="true" />
          )}
          {fullscreen ? "Выйти из полного экрана (Esc)" : "Полный экран"}
        </button>
      </div>

      {/* Metadata — hidden in fullscreen to maximise the editing surface. */}
      {!fullscreen && (
        <div className="rounded-card border-border bg-surface-1 shadow-card grid gap-3 border p-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lesson-title" className="text-text-2 text-[13px]">
              Название
            </label>
            <Input
              id="lesson-title"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lesson-slug" className="text-text-2 text-[13px]">
              Адрес страницы
            </label>
            <Input
              id="lesson-slug"
              value={meta.slug}
              onChange={(e) => setMeta({ ...meta, slug: e.target.value })}
              pattern="[a-z0-9-]+"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lesson-video" className="text-text-2 text-[13px]">
              Видео (YouTube)
            </label>
            <Input
              id="lesson-video"
              value={meta.videoUrl}
              onChange={(e) => setMeta({ ...meta, videoUrl: e.target.value })}
              placeholder="https://youtu.be/…"
            />
            {/* Заход C.4: ссылку не блокируем — предупреждаем. Ментор вправе
                положить видео, которое лежит не на YouTube; он не вправе узнать
                об этом от ученика. */}
            {meta.videoUrl.trim() && !isPlayableVideoUrl(meta.videoUrl.trim()) ? (
              <p className="text-warning text-[12px]">
                Плеер поддерживает только YouTube. Эта ссылка откроется у ученика кнопкой «Открыть
                видео» в новой вкладке
                {videoLinkHost(meta.videoUrl.trim())
                  ? ` (${videoLinkHost(meta.videoUrl.trim())})`
                  : ""}
                , а текст урока будет показан рядом.
              </p>
            ) : null}
          </div>
          <div className="flex items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-text-2 text-[13px]">Сложность</span>
              <Select
                value={meta.difficulty}
                onValueChange={(difficulty) => setMeta({ ...meta, difficulty })}
              >
                <SelectTrigger aria-label="Сложность">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="text-text-2 flex h-9 items-center gap-2 text-[13px]">
              <Switch
                checked={meta.isOptional}
                onCheckedChange={(isOptional) => setMeta({ ...meta, isOptional })}
              />
              необязательный
            </label>
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <span className="text-text-2 text-[13px]">Путь прохождения</span>
            <Select
              value={meta.pathPolicy}
              onValueChange={(pathPolicy) => setMeta({ ...meta, pathPolicy })}
            >
              <SelectTrigger aria-label="Путь прохождения">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PATH_POLICY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-text-3 text-[11px]">
              «На выбор» сохраняет выбранный учеником путь; квиз и завершение остаются общими.
            </p>
          </div>
          {/* Время урока (заход B.2, блок 3.2). Механизм переопределения уже был
              (поля text/video/practice_minutes, коммит e2d7f7e) — не хватало
              главного: ментор не видел, ЧТО показывается ученику сейчас и что
              автооценку можно перебить. Автоматическое значение стоит подсказкой
              прямо в поле; пустое поле = автооценка, заполненное = ручное. */}
          {DURATION_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label htmlFor={`lesson-${key}`} className="text-text-2 text-[13px]">
                {label}
              </label>
              <Input
                id={`lesson-${key}`}
                type="number"
                min={1}
                max={1440}
                value={meta[key]}
                onChange={(event) =>
                  setMeta({
                    ...meta,
                    [key]: event.target.value === "" ? "" : Number(event.target.value),
                  })
                }
                placeholder={
                  key === "textMinutes" ? `Автоматически: ${readingMinutes}` : placeholder
                }
              />
            </div>
          ))}
          <div className="text-text-3 text-[12px] md:col-span-2 lg:col-span-4">
            Ученик увидит: <span className="text-text-2">{durationPreview}</span>. Пусто — время
            текста считается автоматически по объёму ({readingMinutes} мин); впиши своё число, если
            автооценка врёт.
          </div>
          <div className="md:col-span-2 lg:col-span-4">
            <Button variant="secondary" size="sm" loading={pending} onClick={saveMeta}>
              Сохранить метаданные
            </Button>
          </div>
        </div>
      )}

      {/* Mode switch (walk 13.6). «Блоки» is the default: visual cards, no raw
          `:::`/`$$`/fences. «Текст» keeps the markdown source available for
          anything the cards do not cover. Byte safety is per-BLOCK, not
          per-document: a construct the segmentation cannot reproduce exactly is
          demoted to a raw textarea, and untouched blocks are re-emitted verbatim
          — see the «where byte fidelity actually lives» note in
          lib/content/markdown-blocks.ts. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-border inline-flex rounded-[10px] border p-0.5">
          {(["blocks", "text"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={cn(
                "ease-app rounded-[8px] px-3 py-1 text-[12px] font-medium transition-colors duration-150 disabled:opacity-40",
                mode === value ? "bg-surface-2 text-text-1" : "text-text-2 hover:text-text-1",
              )}
            >
              {value === "blocks" ? "Блоки" : "Текст"}
            </button>
          ))}
        </div>
      </div>

      {/* Directive panel (grouped + hints) + inline marks — text mode only: in
          block mode the blocks themselves are the insert affordance. */}
      <div
        className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", mode === "blocks" && "hidden")}
      >
        {SNIPPET_GROUPS.map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="text-text-3 text-[11px] uppercase">{group}</span>
            {SNIPPETS.filter((s) => s.group === group).map((item) => (
              <button
                key={item.label}
                type="button"
                title={item.hint}
                onClick={() => insertSnippet(item)}
                className="rounded-pill border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 h-7 border px-3 text-[12px] transition-colors duration-150"
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
        {/* Заход B.1: вопрос из банка вставляется ВЫБОРОМ, а не набором id —
            поэтому это не сниппет-шаблон, а кнопка с диалогом поиска. */}
        <div className="flex items-center gap-1.5">
          <span className="text-text-3 text-[11px] uppercase">Вопрос</span>
          <button
            type="button"
            title="Вопрос с вариантами прямо в тексте урока (выбор из банка)"
            onClick={() => setPickingQuestion(true)}
            className="rounded-pill border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 h-7 border px-3 text-[12px] transition-colors duration-150"
          >
            Вопрос из банка
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-3 text-[11px] uppercase">Инлайн</span>
          {INLINE_MARKS.map((m) => (
            <button
              key={m.label}
              type="button"
              title={m.title}
              onClick={() => wrapSelection(m.before, m.after)}
              className="rounded-pill border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 h-7 border px-3 text-[12px] transition-colors duration-150"
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-3 text-[11px] uppercase">Выделение</span>
          <button
            type="button"
            title="Обернуть выделенные строки со ссылками в блок материалов (карточки)"
            onClick={wrapLinesInMaterial}
            className="rounded-pill border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 h-7 border px-3 text-[12px] transition-colors duration-150"
          >
            Обернуть в материалы
          </button>
        </div>
      </div>

      {/* Editor ↔ Preview */}
      <div className={cn("grid gap-4 lg:grid-cols-2", fullscreen && "min-h-0 flex-1")}>
        {mode === "blocks" ? (
          <div
            className={cn(
              "rounded-card border-border bg-bg overflow-y-auto border p-3",
              fullscreen ? "h-[80dvh]" : "h-[70dvh]",
            )}
          >
            <BlockEditor value={content} onChange={onContentChange} zone="lesson" />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => onContentChange(event.target.value)}
            onKeyDown={onEditorKeyDown}
            spellCheck={false}
            aria-label="Markdown урока"
            className={cn(
              "rounded-card border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong w-full resize-none border p-4 font-mono text-[13px] leading-relaxed transition-colors duration-150",
              fullscreen ? "h-[80dvh]" : "h-[70dvh]",
            )}
          />
        )}
        <iframe
          key={previewVersion}
          src={`/content-preview/${lesson.id}?v=${previewVersion}`}
          title="Предпросмотр урока"
          className={cn(
            "rounded-card border-border bg-bg w-full border",
            fullscreen ? "h-[80dvh]" : "h-[70dvh]",
          )}
        />
      </div>

      <QuestionBankPicker
        open={pickingQuestion}
        onOpenChange={setPickingQuestion}
        onPick={(row) => insertQuestion(row.id)}
      />
    </div>
  );
}

function Crumb({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChevronRight size={13} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
      <span className="text-text-3 max-w-[160px] truncate text-[13px]">{children}</span>
    </>
  );
}
