"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Copy, ExternalLink, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { BackButton } from "@/components/ui/back-button";
import { ActionButton } from "@/components/features/action-button";
import { cn } from "@/lib/utils/cn";
import {
  deleteGuideAction,
  saveGuideContentAction,
  setGuideStatusAction,
  updateGuideMetaAction,
} from "@/lib/actions/guides";
import { GUIDE_SECTIONS, GUIDE_SECTION_LABEL } from "@/lib/constants";

interface EditorGuide {
  id: string;
  title: string;
  slug: string;
  section: string;
  order: number;
  contentMd: string;
  status: "draft" | "published";
}

// Directive panel (spec 8.5 / 12.1-C10) — guides share the markdown pipeline but
// have no video-lesson/mock semantics; grouped with human names + hints.
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
    group: "Блоки",
    label: "Код",
    hint: "Подсветка Shiki (python/ts/sql/bash/json/yaml)",
    snippet: '\n```python\nprint("hello")\n```\n',
  },
  {
    group: "Блоки",
    label: "Таблица",
    hint: "GFM-таблица (скроллится по горизонтали)",
    snippet: "\n| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n",
  },
];

const SNIPPET_GROUPS = ["Врезки", "Медиа", "Блоки"];

const INLINE_MARKS: { label: string; title: string; before: string; after: string }[] = [
  { label: "Ж", title: "Полужирный", before: "**", after: "**" },
  { label: "код", title: "Инлайн-код", before: "`", after: "`" },
  { label: "$…$", title: "Инлайн-формула", before: "$", after: "$" },
];

const AUTOSAVE_MS = 1000;

export function GuideEditor({ guide }: { guide: EditorGuide }) {
  const router = useRouter();
  const [content, setContent] = useState(guide.contentMd);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [previewVersion, setPreviewVersion] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [meta, setMeta] = useState({
    title: guide.title,
    slug: guide.slug,
    section: guide.section,
    order: String(guide.order),
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
    return saveGuideContentAction(guide.id, latestContent.current).then((result) => {
      if (result?.ok) {
        setSaveState("saved");
        setPreviewVersion((version) => version + 1);
        return true;
      }
      setSaveState("dirty");
      if (result) toast({ title: result.error.message, variant: "danger" });
      return false;
    });
  }, [guide.id]);

  function onContentChange(value: string): void {
    setContent(value);
    latestContent.current = value;
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, AUTOSAVE_MS);
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        flushSave();
      }
    };
  }, [flushSave]);

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
    const url = `${window.location.origin}/guide-preview/${guide.id}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: "Ссылка на превью скопирована", variant: "success" }))
      .catch(() => toast({ title: "Не удалось скопировать", variant: "danger" }));
  }

  function saveMeta(): void {
    startTransition(async () => {
      const result = await updateGuideMetaAction({
        guideId: guide.id,
        title: meta.title,
        slug: meta.slug,
        section: meta.section,
        order: Number(meta.order),
      });
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
    const target = guide.status === "published" ? "draft" : "published";
    startTransition(async () => {
      const result = await setGuideStatusAction(guide.id, target);
      if (!result) return;
      if (result.ok) {
        toast({
          title: target === "published" ? "Гайд опубликован" : "Гайд снят с публикации",
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <BackButton href="/admin/content/guides" label="Справочник" className="w-auto" />
        <span className="text-text-3 text-[13px]">
          · {GUIDE_SECTION_LABEL[guide.section] ?? guide.section}
        </span>
        <span className="text-text-3 ml-auto text-[12px] tabular-nums" aria-live="polite">
          {saveLabel} · {wordCount} сл.
        </span>
        {guide.status === "published" ? (
          <Badge variant="success">опубликован</Badge>
        ) : (
          <Badge variant="warning">черновик</Badge>
        )}
        <Button variant="secondary" size="sm" loading={pending} onClick={togglePublish}>
          {guide.status === "published" ? "В черновик" : "Опубликовать"}
        </Button>
        <Button asChild variant="primary" size="sm">
          <a href={`/guide-preview/${guide.id}`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            Открыть предпросмотр
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
        {guide.status === "draft" && (
          <ActionButton
            action={() => deleteGuideAction(guide.id)}
            className="text-danger"
            successMessage="Гайд удалён"
            confirm={{
              title: "Удалить гайд?",
              description: "Черновик будет удалён без возможности восстановления.",
              actionLabel: "Удалить",
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            Удалить
          </ActionButton>
        )}
      </div>

      {/* Metadata — hidden in fullscreen. */}
      {!fullscreen && (
        <div className="rounded-card border-border bg-surface-1 grid gap-3 border p-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guide-title" className="text-text-2 text-[13px]">
              Название
            </label>
            <Input
              id="guide-title"
              value={meta.title}
              onChange={(e) => setMeta({ ...meta, title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guide-slug" className="text-text-2 text-[13px]">
              Slug
            </label>
            <Input
              id="guide-slug"
              value={meta.slug}
              onChange={(e) => setMeta({ ...meta, slug: e.target.value })}
              pattern="[a-z0-9-]+"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-text-2 text-[13px]">Секция</span>
            <Select value={meta.section} onValueChange={(section) => setMeta({ ...meta, section })}>
              <SelectTrigger aria-label="Секция">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GUIDE_SECTIONS.map((section) => (
                  <SelectItem key={section} value={section}>
                    {GUIDE_SECTION_LABEL[section] ?? section}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guide-order" className="text-text-2 text-[13px]">
              Порядок
            </label>
            <Input
              id="guide-order"
              type="number"
              min={0}
              value={meta.order}
              onChange={(e) => setMeta({ ...meta, order: e.target.value })}
            />
          </div>
          <div className="md:col-span-2 lg:col-span-4">
            <Button variant="secondary" size="sm" loading={pending} onClick={saveMeta}>
              Сохранить метаданные
            </Button>
          </div>
        </div>
      )}

      {/* Directive panel + inline marks */}
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
          aria-label="Markdown гайда"
          className={cn(
            "rounded-card border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong w-full resize-none border p-4 font-mono text-[13px] leading-relaxed transition-colors duration-150",
            fullscreen ? "h-[80dvh]" : "h-[70dvh]",
          )}
        />
        <iframe
          key={previewVersion}
          src={`/guide-preview/${guide.id}?v=${previewVersion}`}
          title="Предпросмотр гайда"
          className={cn(
            "rounded-card border-border bg-bg w-full border",
            fullscreen ? "h-[80dvh]" : "h-[70dvh]",
          )}
        />
      </div>
    </div>
  );
}
