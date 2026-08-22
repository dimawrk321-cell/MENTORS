"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Code2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Underline as UnderlineIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { richTextExtensions, RICH_TEXT_SIZE } from "@/lib/content/rich-text";
import { sanitizeUrl } from "@/lib/utils/safe-url";
import { cn } from "@/lib/utils/cn";

interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onBlur?: () => void;
  ariaLabel: string;
}

const TOOL_BUTTON =
  "text-text-2 hover:bg-surface-1 hover:text-text-1 flex size-9 items-center justify-center rounded-[6px] transition-colors disabled:opacity-35 md:size-8";

function setLink(editor: Editor): void {
  const previous = editor.getAttributes("link").href as string | undefined;
  const value = window.prompt("Ссылка", previous ?? "https://");
  if (value === null) return;
  if (value.trim() === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  const href = sanitizeUrl(value.trim(), "href");
  if (!href) return;
  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

function RichTextToolbar({ editor, compact = false }: { editor: Editor; compact?: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      code: current.isActive("code"),
      link: current.isActive("link"),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      blockquote: current.isActive("blockquote"),
      heading1: current.isActive("heading", { level: 1 }),
      heading2: current.isActive("heading", { level: 2 }),
      heading3: current.isActive("heading", { level: 3 }),
      small: current.isActive("textStyle", { fontSize: RICH_TEXT_SIZE.small }),
      large: current.isActive("textStyle", { fontSize: RICH_TEXT_SIZE.large }),
    }),
  });

  const button = (label: string, active: boolean, action: () => void, icon: React.ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
      className={cn(TOOL_BUTTON, active && "bg-accent/12 text-accent")}
    >
      {icon}
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label={compact ? "Форматирование выделения" : "Форматирование текста"}
      className={cn(
        "border-border bg-surface-2 flex flex-wrap items-center gap-0.5",
        compact ? "shadow-elevated rounded-control border p-1" : "border-b px-2 py-1.5",
      )}
    >
      {button(
        "Полужирный",
        state.bold,
        () => editor.chain().focus().toggleBold().run(),
        <Bold size={15} />,
      )}
      {button(
        "Курсив",
        state.italic,
        () => editor.chain().focus().toggleItalic().run(),
        <Italic size={15} />,
      )}
      {button(
        "Подчёркивание",
        state.underline,
        () => editor.chain().focus().toggleUnderline().run(),
        <UnderlineIcon size={15} />,
      )}
      {button(
        "Инлайн-код",
        state.code,
        () => editor.chain().focus().toggleCode().run(),
        <Code2 size={15} />,
      )}
      {button("Ссылка", state.link, () => setLink(editor), <LinkIcon size={15} />)}

      {!compact && (
        <>
          <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
          <Select
            value={state.heading1 ? "h1" : state.heading2 ? "h2" : state.heading3 ? "h3" : "p"}
            onValueChange={(value) => {
              if (value === "p") editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                  .run();
            }}
          >
            <SelectTrigger className="h-8 w-[118px]" aria-label="Стиль абзаца">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="p">Обычный текст</SelectItem>
              <SelectItem value="h1">Заголовок H1</SelectItem>
              <SelectItem value="h2">Заголовок H2</SelectItem>
              <SelectItem value="h3">Заголовок H3</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={state.small ? "small" : state.large ? "large" : "normal"}
            onValueChange={(value) => {
              if (value === "normal") editor.chain().focus().unsetFontSize().run();
              else
                editor
                  .chain()
                  .focus()
                  .setFontSize(RICH_TEXT_SIZE[value as "small" | "large"])
                  .run();
            }}
          >
            <SelectTrigger className="h-8 w-[104px]" aria-label="Размер текста">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="small">Маленький</SelectItem>
              <SelectItem value="normal">Обычный</SelectItem>
              <SelectItem value="large">Крупный</SelectItem>
            </SelectContent>
          </Select>
          <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
          {button(
            "Маркированный список",
            state.bulletList,
            () => editor.chain().focus().toggleBulletList().run(),
            <List size={16} />,
          )}
          {button(
            "Нумерованный список",
            state.orderedList,
            () => editor.chain().focus().toggleOrderedList().run(),
            <ListOrdered size={16} />,
          )}
          {button(
            "Цитата",
            state.blockquote,
            () => editor.chain().focus().toggleBlockquote().run(),
            <Quote size={16} />,
          )}
        </>
      )}
    </div>
  );
}

export function RichTextEditor({ value, onChange, onBlur, ariaLabel }: RichTextEditorProps) {
  const lastEmitted = useRef(value);
  const editor = useEditor({
    extensions: richTextExtensions(),
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rich-text-surface min-h-[132px] px-4 py-3 outline-none",
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown();
      lastEmitted.current = markdown;
      onChange(markdown);
    },
    onBlur,
  });

  useEffect(() => {
    if (!editor || value === lastEmitted.current || value === editor.getMarkdown()) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  if (!editor) {
    return (
      <div className="border-border bg-surface-2 rounded-control min-h-[180px] animate-pulse border" />
    );
  }

  return (
    <div className="border-border bg-surface-2 rounded-control overflow-hidden border">
      <RichTextToolbar editor={editor} />
      <BubbleMenu
        editor={editor}
        shouldShow={({ editor: current, from, to }) => current.isEditable && from !== to}
      >
        <RichTextToolbar editor={editor} compact />
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
