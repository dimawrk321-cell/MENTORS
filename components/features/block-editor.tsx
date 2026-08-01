"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
// Route-scoped: the editor renders KaTeX itself, and the styled live preview is
// a separate document (iframe), so its stylesheet cannot reach this page.
import "katex/dist/katex.min.css";
import katex from "katex";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  FileText,
  Info,
  Plus,
  Sigma,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
  Video as VideoIcon,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parse,
  renderBlock,
  serialize,
  withEdit,
  type Block,
  type BlockKind,
} from "@/lib/content/markdown-blocks";
import { cn } from "@/lib/utils/cn";

// Visual block editor (walk 13.6 block 1). The mentor never sees `:::`, `$$` or
// triple backticks: recognised blocks render as titled cards with real fields,
// while paragraphs/headings/lists stay in a plain textarea (markdown there is
// readable — the complaint was about directive syntax). Storage stays markdown;
// see lib/content/markdown-blocks.ts for the byte-fidelity guarantee.

const CALLOUT_META: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  tip: { label: "Совет", icon: Info, tone: "var(--accent)" },
  important: { label: "Важное", icon: TriangleAlert, tone: "var(--warning)" },
  warning: { label: "Предупреждение", icon: TriangleAlert, tone: "var(--danger)" },
  material: { label: "Материал", icon: FileText, tone: "var(--text-2)" },
};

const CODE_LANGS = ["python", "typescript", "javascript", "sql", "bash", "json", "yaml", "text"];

const KIND_META: Record<BlockKind, { label: string; icon: LucideIcon }> = {
  prose: { label: "Текст", icon: FileText },
  code: { label: "Код", icon: Code2 },
  callout: { label: "Врезка", icon: Info },
  video: { label: "Видео", icon: VideoIcon },
  practice: { label: "Практика", icon: Wrench },
  mock: { label: "Мок-интервью", icon: VideoIcon },
  math: { label: "Формула", icon: Sigma },
  table: { label: "Таблица", icon: TableIcon },
};

function youtubeId(url: string): string | null {
  const m = /(?:youtu\.be\/|v=|embed\/)([\w-]{11})/.exec(url);
  return m ? m[1]! : null;
}

/** Renders a formula with the same KaTeX package the server uses. */
function Katex({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: true, throwOnError: false });
    } catch {
      return "";
    }
  }, [tex]);
  if (!tex.trim()) return <p className="text-text-3 text-[12px]">Введи формулу — покажу рядом.</p>;
  // KaTeX output with throwOnError:false — the same package version the server
  // render uses, so this authoring preview cannot drift from the student view.
  return <div className="overflow-x-auto text-[15px]" dangerouslySetInnerHTML={{ __html: html }} />;
}

function textareaClass(extra?: string): string {
  return cn(
    "rounded-control border-border bg-surface-2 text-text-1 ease-app hover:border-border-strong focus:border-accent w-full resize-y border p-3 text-[14px] leading-relaxed transition-colors duration-150 outline-none",
    extra,
  );
}

// --- Markdown table ↔ cell grid ---
//
// The delimiter row must be recognised by its DASHES. The old pattern
// `\|[\s:|-]+\|` had space inside the character class, so `|  |  |` — what an
// all-blank row serialises to — was classified as structure and silently
// deleted. That made «+ Строка» a no-op and made clearing a row destroy it.
const DELIMITER_ROW = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/;

/** Split on unescaped pipes only: `P(A\|B)` is one cell, not two (GFM). */
function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

interface ParsedTable {
  grid: string[][];
  /** The delimiter row verbatim — alignment colons are the mentor's, not ours. */
  delimiter: string | null;
}

function tableToGrid(md: string): ParsedTable {
  const lines = md.split("\n").filter((line) => line.trim().startsWith("|"));
  const delimiter = lines.find((line) => DELIMITER_ROW.test(line)) ?? null;
  return {
    grid: lines.filter((line) => !DELIMITER_ROW.test(line)).map(splitCells),
    delimiter: delimiter ? delimiter.trim() : null,
  };
}

function gridToTable(grid: string[][], delimiter: string | null, eol: string): string {
  if (grid.length === 0) return "";
  const cols = Math.max(...grid.map((row) => row.length));
  const pad = (row: string[]) =>
    `| ${Array.from({ length: cols }, (_, i) => (row[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;

  // Re-emit the original delimiter so column alignment survives an edit; pad it
  // out only if the mentor added columns.
  const existing = delimiter ? splitCells(delimiter) : [];
  const delimiterRow = `| ${Array.from({ length: cols }, (_, i) => existing[i] ?? "---").join(" | ")} |`;

  const [header, ...body] = grid;
  return [pad(header!), delimiterRow, ...body.map(pad)].join("\n") + (eol === "" ? "" : "\n");
}

function BlockCard({
  block,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  block: Block;
  index: number;
  total: number;
  onChange: (next: Block) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const meta = KIND_META[block.kind];
  const callout = block.kind === "callout" ? CALLOUT_META[block.variant] : undefined;
  const Icon = callout?.icon ?? meta.icon;
  const label =
    block.kind === "callout"
      ? (callout?.label ?? "Врезка")
      : block.kind === "code"
        ? `Код · ${block.lang || "text"}`
        : meta.label;
  const tone = callout?.tone;
  const [confirming, setConfirming] = useState(false);

  // Deleting a block autosaves a second later and the editor has no undo, so the
  // action asks first. Two clicks, in place — a dialog here would fight the
  // card's own layout, and the second click is the confirmation.
  const confirmRemove = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onRemove();
  };

  return (
    <div
      className="rounded-card border-border bg-surface-1 border"
      style={tone ? { borderLeft: `2px solid ${tone}` } : undefined}
      onMouseLeave={() => setConfirming(false)}
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <Icon
          size={15}
          strokeWidth={1.75}
          className="shrink-0"
          style={tone ? { color: tone } : undefined}
          aria-hidden="true"
        />
        <span className="text-text-2 flex-1 text-[12px] font-medium">{label}</span>
        <button
          type="button"
          aria-label="Выше"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className="text-text-3 hover:text-text-1 ease-app flex size-11 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-150 disabled:opacity-30 md:size-8"
        >
          <ChevronUp size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Ниже"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          className="text-text-3 hover:text-text-1 ease-app flex size-11 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-150 disabled:opacity-30 md:size-8"
        >
          <ChevronDown size={14} strokeWidth={1.75} />
        </button>
        {confirming && (
          <span className="text-danger shrink-0 text-[12px] font-medium">Удалить?</span>
        )}
        <button
          type="button"
          aria-label={confirming ? "Подтвердить удаление блока" : "Удалить блок"}
          onClick={confirmRemove}
          className={cn(
            "text-text-3 hover:text-danger ease-app flex size-11 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-150 md:size-8",
            confirming && "text-danger bg-danger/12",
          )}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {block.kind === "callout" && (
          <>
            <Select
              value={block.variant}
              onValueChange={(value) => onChange(withEdit(block, { variant: value }))}
            >
              <SelectTrigger className="w-48" aria-label="Тип врезки">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CALLOUT_META).map(([key, m]) => (
                  <SelectItem key={key} value={key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <textarea
              value={block.body}
              onChange={(e) => onChange(withEdit(block, { body: e.target.value }))}
              rows={3}
              className={textareaClass()}
              aria-label="Текст врезки"
            />
          </>
        )}

        {block.kind === "code" && (
          <>
            <Select
              value={block.lang || "text"}
              onValueChange={(value) => onChange(withEdit(block, { lang: value }))}
            >
              <SelectTrigger className="w-40" aria-label="Язык кода">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(CODE_LANGS.includes(block.lang) || !block.lang
                  ? CODE_LANGS
                  : // Keep whatever the fence actually says, or the trigger renders empty.
                    [block.lang, ...CODE_LANGS]
                ).map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <textarea
              value={block.body}
              onChange={(e) => onChange(withEdit(block, { body: e.target.value }))}
              rows={6}
              spellCheck={false}
              className={textareaClass("font-mono text-[13px]")}
              aria-label="Код"
            />
          </>
        )}

        {block.kind === "math" && (
          <div className="grid gap-2 md:grid-cols-2">
            <textarea
              value={block.body}
              onChange={(e) => onChange(withEdit(block, { body: e.target.value }))}
              rows={4}
              spellCheck={false}
              className={textareaClass("font-mono text-[13px]")}
              aria-label="Формула (KaTeX)"
            />
            <div className="rounded-control border-border bg-surface-2 border p-3">
              <Katex tex={block.body} />
            </div>
          </div>
        )}

        {block.kind === "video" && (
          <div className="grid gap-2 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Input
                value={block.url}
                onChange={(e) => onChange(withEdit(block, { url: e.target.value }))}
                placeholder="https://youtu.be/…"
                aria-label="Ссылка на видео"
              />
              <Input
                value={block.title}
                onChange={(e) => onChange(withEdit(block, { title: e.target.value }))}
                placeholder="Название"
                aria-label="Название видео"
              />
            </div>
            <div className="rounded-control border-border bg-surface-2 flex aspect-video items-center justify-center overflow-hidden border">
              {youtubeId(block.url) ? (
                // i.ytimg.com is already an allowed remotePattern (next.config.ts).
                <Image
                  src={`https://i.ytimg.com/vi/${youtubeId(block.url)}/hqdefault.jpg`}
                  alt=""
                  width={480}
                  height={360}
                  unoptimized
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-text-3 px-3 text-center text-[12px]">
                  Вставь ссылку YouTube — покажу превью
                </span>
              )}
            </div>
          </div>
        )}

        {block.kind === "mock" && (
          <Select
            value={block.variant}
            onValueChange={(value) => onChange(withEdit(block, { variant: value }))}
          >
            <SelectTrigger className="w-48" aria-label="Тип мока">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="legend">По легенде</SelectItem>
              <SelectItem value="theory">ML-теория</SelectItem>
            </SelectContent>
          </Select>
        )}

        {block.kind === "practice" && (
          <textarea
            value={block.body}
            onChange={(e) => onChange(withEdit(block, { body: e.target.value }))}
            rows={4}
            className={textareaClass()}
            aria-label="Содержимое блока практики"
          />
        )}

        {block.kind === "table" && <TableGrid block={block} onChange={onChange} />}

        {block.kind === "prose" && (
          <textarea
            value={block.body}
            onChange={(e) => onChange(withEdit(block, { body: e.target.value }))}
            rows={Math.min(14, Math.max(3, block.body.split("\n").length + 1))}
            className={textareaClass()}
            aria-label="Текст"
          />
        )}
      </div>
    </div>
  );
}

function TableGrid({ block, onChange }: { block: Block; onChange: (next: Block) => void }) {
  const { grid, delimiter } = tableToGrid(block.body);
  const cols = grid.length ? Math.max(...grid.map((r) => r.length)) : 0;

  const push = (next: string[][]) =>
    onChange(withEdit(block, { body: gridToTable(next, delimiter, block.eol) }));

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="text-[13px]">
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="p-0.5">
                    <input
                      value={row[c] ?? ""}
                      onChange={(e) => {
                        const next = grid.map((line) => [...line]);
                        while (next[r]!.length < cols) next[r]!.push("");
                        next[r]![c] = e.target.value;
                        push(next);
                      }}
                      aria-label={`Ячейка ${r + 1}·${c + 1}`}
                      className={cn(
                        "rounded-control border-border bg-surface-2 focus:border-accent w-32 border px-2 py-1 outline-none",
                        r === 0 && "font-semibold",
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => push([...grid, Array.from({ length: cols || 2 }, () => "")])}
        >
          <Plus size={14} strokeWidth={1.75} />
          Строка
        </Button>
        <Button variant="secondary" size="sm" onClick={() => push(grid.map((row) => [...row, ""]))}>
          <Plus size={14} strokeWidth={1.75} />
          Колонка
        </Button>
      </div>
    </div>
  );
}

const NEW_BLOCKS: Array<{ kind: BlockKind; label: string; variant?: string; body?: string }> = [
  { kind: "prose", label: "Текст", body: "Новый абзац." },
  { kind: "callout", label: "Совет", variant: "tip", body: "Текст совета." },
  { kind: "callout", label: "Важное", variant: "important", body: "Важный текст." },
  { kind: "callout", label: "Предупреждение", variant: "warning", body: "Предупреждение." },
  { kind: "callout", label: "Материал", variant: "material", body: "- [Ссылка](https://)" },
  { kind: "code", label: "Код", body: 'print("hello")' },
  { kind: "math", label: "Формула", body: "E = mc^2" },
  { kind: "video", label: "Видео" },
  { kind: "practice", label: "Практика", body: "- [Задание](https://)" },
  { kind: "table", label: "Таблица" },
  { kind: "mock", label: "Мок-интервью", variant: "legend" },
];

let newIdCounter = 0;

export function BlockEditor({
  value,
  onChange,
  zone = "lesson",
}: {
  value: string;
  onChange: (markdown: string) => void;
  zone?: "lesson" | "guide";
}) {
  // Parsed once per mounted document; edits live in this state and are serialised
  // back on every change (only dirty blocks re-render — see markdown-blocks).
  const [blocks, setBlocks] = useState<Block[]>(() => parse(value));

  const commit = (next: Block[]) => {
    setBlocks(next);
    onChange(serialize(next));
  };

  const available = NEW_BLOCKS.filter((b) => zone === "lesson" || b.kind !== "mock");

  const addBlock = (template: (typeof NEW_BLOCKS)[number]) => {
    newIdCounter += 1;
    const seed: Block = {
      id: `new${newIdCounter}`,
      kind: template.kind,
      raw: "",
      body: template.body ?? "",
      variant: template.variant ?? "",
      lang: template.kind === "code" ? "python" : "",
      url: "",
      title: "",
      editable: true,
      dirty: true,
      eol: "\n",
    };
    if (template.kind === "table")
      seed.body = "| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n";
    if (template.kind === "prose") seed.body = `${template.body ?? ""}\n\n`;
    seed.raw = renderBlock(seed);
    commit([...blocks, seed]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {available.map((template) => (
          <Button
            key={template.label}
            variant="secondary"
            size="sm"
            onClick={() => addBlock(template)}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            {template.label}
          </Button>
        ))}
      </div>

      {blocks.length === 0 ? (
        <p className="text-text-3 text-[13px]">Пусто — добавь первый блок кнопками выше.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {blocks.map((block, index) => (
            <BlockCard
              key={block.id}
              block={block}
              index={index}
              total={blocks.length}
              onChange={(next) => commit(blocks.map((b, i) => (i === index ? next : b)))}
              onRemove={() => commit(blocks.filter((_, i) => i !== index))}
              onMove={(delta) => {
                const target = index + delta;
                if (target < 0 || target >= blocks.length) return;
                const next = [...blocks];
                [next[index], next[target]] = [next[target]!, next[index]!];
                commit(next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
