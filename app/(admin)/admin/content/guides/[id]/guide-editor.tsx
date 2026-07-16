"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
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
import { ActionButton } from "@/components/features/action-button";
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

// Same directive toolbar as the lesson editor (spec 8.5) — guides share the
// markdown pipeline; no video/quiz/mock directives here.
const SNIPPETS: Array<{ label: string; snippet: string }> = [
  { label: "Совет", snippet: '\n:::callout{type="tip"}\nТекст совета.\n:::\n' },
  { label: "Важное", snippet: '\n:::callout{type="important"}\nВажный текст.\n:::\n' },
  { label: "Материал", snippet: '\n:::callout{type="material"}\n- [Ссылка](https://)\n:::\n' },
  { label: "Практика", snippet: "\n:::practice\n- [Задание](https://)\n:::\n" },
  { label: "Видео", snippet: '\n:::video{url="https://youtu.be/..." title="Название"}\n:::\n' },
  { label: "Код", snippet: '\n```python\nprint("hello")\n```\n' },
  { label: "Таблица", snippet: "\n| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n" },
];

const AUTOSAVE_MS = 1000;

export function GuideEditor({ guide }: { guide: EditorGuide }) {
  const router = useRouter();
  const [content, setContent] = useState(guide.contentMd);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [previewVersion, setPreviewVersion] = useState(0);
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

  const flushSave = useCallback(() => {
    saveTimer.current = null;
    setSaveState("saving");
    void saveGuideContentAction(guide.id, latestContent.current).then((result) => {
      if (result?.ok) {
        setSaveState("saved");
        setPreviewVersion((version) => version + 1);
      } else {
        setSaveState("dirty");
        if (result) toast({ title: result.error.message, variant: "danger" });
      }
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/content/guides"
          className="text-text-3 ease-app hover:text-text-1 flex items-center gap-1.5 text-[13px] transition-colors duration-150"
        >
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          Справочник
        </Link>
        <span className="text-text-3 ml-auto text-[12px]" aria-live="polite">
          {saveLabel}
        </span>
        {guide.status === "published" ? (
          <Badge variant="success">опубликован</Badge>
        ) : (
          <Badge>черновик</Badge>
        )}
        <Button variant="secondary" size="sm" loading={pending} onClick={togglePublish}>
          {guide.status === "published" ? "В черновик" : "Опубликовать"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={`/guide-preview/${guide.id}`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
            Открыть предпросмотр
          </a>
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

      {/* Metadata */}
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
          aria-label="Markdown гайда"
          className="rounded-card border-border bg-surface-1 text-text-1 ease-app hover:border-border-strong h-[70dvh] w-full resize-none border p-4 font-mono text-[13px] leading-relaxed transition-colors duration-150"
        />
        <iframe
          key={previewVersion}
          src={`/guide-preview/${guide.id}?v=${previewVersion}`}
          title="Предпросмотр гайда"
          className="rounded-card border-border bg-bg h-[70dvh] w-full border"
        />
      </div>
    </div>
  );
}
