"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronRight, Copy, ExternalLink, Maximize2, Minimize2 } from "lucide-react";
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
import { BackButton } from "@/components/ui/back-button";
import { cn } from "@/lib/utils/cn";
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

// Directive insert panel (spec 8.5 / 12.1-C10): grouped, human names + hints.
interface Snippet {
  group: string;
  label: string;
  hint: string;
  snippet: string;
}

const SNIPPETS: Snippet[] = [
  {
    group: "Врезки",
    label: "Совет",
    hint: "Зелёная врезка с подсказкой",
    snippet: '\n:::callout{type="tip"}\nТекст совета.\n:::\n',
  },
  {
    group: "Врезки",
    label: "Важное",
    hint: "Жёлтая врезка-акцент",
    snippet: '\n:::callout{type="important"}\nВажный текст.\n:::\n',
  },
  {
    group: "Врезки",
    label: "Предупреждение",
    hint: "Красная врезка-предостережение",
    snippet: '\n:::callout{type="warning"}\nПредупреждение.\n:::\n',
  },
  {
    group: "Врезки",
    label: "Материал",
    hint: "Серая врезка со ссылками на источники",
    snippet: '\n:::callout{type="material"}\n- [Ссылка](https://)\n:::\n',
  },
  {
    group: "Медиа",
    label: "Видео",
    hint: "Встроенный YouTube-плеер",
    snippet: '\n:::video{url="https://youtu.be/..." title="Название"}\n:::\n',
  },
  {
    group: "Медиа",
    label: "Практика",
    hint: "Блок практических заданий",
    snippet: "\n:::practice\n- [Задание](https://)\n:::\n",
  },
  {
    group: "Медиа",
    label: "Мок-интервью",
    hint: "CTA «Забронировать мок» (legend / theory)",
    snippet: '\n:::mock{type="legend"}\n:::\n',
  },
  {
    group: "Блоки",
    label: "Код",
    hint: "Подсветка Shiki (python/ts/sql/bash/json/yaml)",
    snippet: '\n```python\nprint("hello")\n```\n',
  },
  { group: "Блоки", label: "Формула", hint: "KaTeX-блок ($$…$$)", snippet: "\n$$\nE = mc^2\n$$\n" },
  {
    group: "Блоки",
    label: "Таблица",
    hint: "GFM-таблица (скроллится по горизонтали)",
    snippet: "\n| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n",
  },
];

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

  const wordCount = useMemo(
    () => (content.trim() ? content.trim().split(/\s+/).length : 0),
    [content],
  );

  const flushSave = useCallback((): Promise<boolean> => {
    saveTimer.current = null;
    setSaveState("saving");
    return saveLessonContentAction(lesson.id, latestContent.current).then((result) => {
      if (result?.ok) {
        setReadingMinutes(result.data.readingMinutes);
        setSaveState("saved");
        setPreviewVersion((version) => version + 1);
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
    <div
      className={cn(
        "flex flex-col gap-4",
        fullscreen && "bg-bg fixed inset-0 z-50 overflow-auto p-4",
      )}
    >
      {/* Breadcrumbs + actions (spec 12.1/C10) */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <BackButton href="/admin/content" label="Контент" className="w-auto" />
        <Crumb>{courseTitle}</Crumb>
        <Crumb>{moduleTitle}</Crumb>
        <ChevronRight size={13} strokeWidth={1.75} className="text-text-3" aria-hidden="true" />
        <span className="text-text-1 max-w-[220px] truncate text-[13px] font-medium">
          {meta.title}
        </span>
        <span className="text-text-3 ml-auto text-[12px] tabular-nums" aria-live="polite">
          {saveLabel} · {readingMinutes} мин · {wordCount} сл.
        </span>
        {lesson.status === "published" ? (
          <Badge variant="success">опубликован</Badge>
        ) : (
          <Badge variant="warning">черновик</Badge>
        )}
        <Button variant="secondary" size="sm" loading={pending} onClick={togglePublish}>
          {lesson.status === "published" ? "В черновик" : "Опубликовать"}
        </Button>
        {/* DECISION: студенческая зона закрыта для mentor+, поэтому «Открыть как
            ученика» открывает полностраничный превью-рендер (тот же LessonRenderer). */}
        <Button asChild variant="primary" size="sm">
          <a href={`/content-preview/${lesson.id}`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            Открыть как ученика
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={copyPreviewLink}
          aria-label="Скопировать ссылку на превью"
          title="Скопировать ссылку на превью"
        >
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFullscreen((v) => !v)}
          aria-label={fullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
          title={fullscreen ? "Выйти (Esc)" : "Полноэкранный режим"}
        >
          {fullscreen ? (
            <Minimize2 size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Maximize2 size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* Metadata — hidden in fullscreen to maximise the editing surface. */}
      {!fullscreen && (
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
      )}

      {/* Directive panel (grouped + hints) + inline marks */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {SNIPPET_GROUPS.map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="text-text-3 text-[11px] uppercase">{group}</span>
            {SNIPPETS.filter((s) => s.group === group).map((item) => (
              <button
                key={item.label}
                type="button"
                title={item.hint}
                onClick={() => insertSnippet(item.snippet)}
                className="rounded-pill border-border text-text-2 ease-app hover:border-border-strong hover:text-text-1 h-7 border px-3 text-[12px] transition-colors duration-150"
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
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
      </div>

      {/* Editor ↔ Preview */}
      <div className={cn("grid gap-4 lg:grid-cols-2", fullscreen && "min-h-0 flex-1")}>
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
