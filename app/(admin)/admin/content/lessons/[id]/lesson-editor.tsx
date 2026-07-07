"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
}

const DIFFICULTY_OPTIONS = [
  { value: "intro", label: "Интро" },
  { value: "base", label: "База" },
  { value: "advanced", label: "Продвинутый" },
] as const;

// Toolbar snippets (spec 8.5: тулбар вставки директив).
const SNIPPETS: Array<{ label: string; snippet: string }> = [
  { label: "Совет", snippet: '\n:::callout{type="tip"}\nТекст совета.\n:::\n' },
  { label: "Важное", snippet: '\n:::callout{type="important"}\nВажный текст.\n:::\n' },
  { label: "Предупреждение", snippet: '\n:::callout{type="warning"}\nПредупреждение.\n:::\n' },
  { label: "Материал", snippet: '\n:::callout{type="material"}\n- [Ссылка](https://)\n:::\n' },
  { label: "Видео", snippet: '\n:::video{url="https://youtu.be/..." title="Название"}\n:::\n' },
  { label: "Практика", snippet: "\n:::practice\n- [Задание](https://)\n:::\n" },
  { label: "Мок", snippet: '\n:::mock{type="legend"}\n:::\n' },
  { label: "Код", snippet: '\n```python\nprint("hello")\n```\n' },
  { label: "Формула", snippet: "\n$$\nE = mc^2\n$$\n" },
  {
    label: "Таблица",
    snippet: "\n| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n",
  },
];

const AUTOSAVE_MS = 1000;

/**
 * Live preview = the student render by construction: the right pane is an
 * iframe of /content-preview/[id] refreshed after each debounced autosave —
 * one render path, zero drift (spec 8.5: рендер идентичен ученическому).
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
  const [meta, setMeta] = useState({
    title: lesson.title,
    slug: lesson.slug,
    videoUrl: lesson.videoUrl,
    difficulty: lesson.difficulty as string,
    isOptional: lesson.isOptional,
  });
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContent = useRef(content);

  const flushSave = useCallback(() => {
    saveTimer.current = null;
    setSaveState("saving");
    void saveLessonContentAction(lesson.id, latestContent.current).then((result) => {
      if (result?.ok) {
        setReadingMinutes(result.data.readingMinutes);
        setSaveState("saved");
        setPreviewVersion((version) => version + 1);
      } else {
        setSaveState("dirty");
        if (result) toast({ title: result.error.message, variant: "danger" });
      }
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

  function insertSnippet(snippet: string): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = content.slice(0, start) + snippet + content.slice(end);
    onContentChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
    });
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
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/content"
          className="text-text-3 ease-app hover:text-text-1 flex items-center gap-1.5 text-[13px] transition-colors duration-150"
        >
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          Контент
        </Link>
        <span className="text-text-3 text-[13px]">
          {courseTitle} · {moduleTitle}
        </span>
        <span className="text-text-3 ml-auto text-[12px]" aria-live="polite">
          {saveLabel} · {readingMinutes} мин чтения
        </span>
        {lesson.status === "published" ? (
          <Badge variant="success">опубликован</Badge>
        ) : (
          <Badge>черновик</Badge>
        )}
        <Button variant="secondary" size="sm" loading={pending} onClick={togglePublish}>
          {lesson.status === "published" ? "В черновик" : "Опубликовать"}
        </Button>
        {/* DECISION: студенческая зона закрыта для mentor+, поэтому «Открыть как
            ученика» открывает полностраничный превью-рендер (тот же LessonRenderer);
            полноценный режим «глазами ученика» — impersonation из карточки. */}
        <Button asChild variant="ghost" size="sm">
          <a href={`/content-preview/${lesson.id}`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            Открыть как ученика
          </a>
        </Button>
      </div>

      {/* Metadata */}
      <div className="rounded-card border-border bg-surface-1 grid gap-3 border p-4 md:grid-cols-2 lg:grid-cols-4">
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
            Slug
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
        <div className="md:col-span-2 lg:col-span-4">
          <Button variant="secondary" size="sm" loading={pending} onClick={saveMeta}>
            Сохранить метаданные
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-1.5">
        {SNIPPETS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => insertSnippet(item.snippet)}
            className="rounded-pill border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 h-7 border px-3 text-[12px] transition-colors duration-150"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Editor ↔ Preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          spellCheck={false}
          aria-label="Markdown урока"
          className="rounded-card border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong h-[70dvh] w-full resize-none border p-4 font-mono text-[13px] leading-relaxed transition-colors duration-150"
        />
        <iframe
          key={previewVersion}
          src={`/content-preview/${lesson.id}?v=${previewVersion}`}
          title="Предпросмотр урока"
          className="rounded-card border-border bg-bg h-[70dvh] w-full border"
        />
      </div>
    </div>
  );
}
