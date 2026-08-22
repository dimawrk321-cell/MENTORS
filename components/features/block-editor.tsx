"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
// Route-scoped: the editor renders KaTeX itself, and the styled live preview is
// a separate document (iframe), so its stylesheet cannot reach this page.
import "katex/dist/katex.min.css";
import katex from "katex";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  EyeOff,
  FileText,
  Info,
  ListChecks,
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
import { toast } from "@/components/ui/toast";
import { QuestionBankPicker } from "@/components/features/question-bank-picker";
import { RichTextEditor } from "@/components/features/rich-text-editor";
import { lookupQuizQuestionAction, type QuizPickerRow } from "@/lib/actions/questions-admin";
import {
  parse,
  renderBlock,
  serialize,
  withEdit,
  type Block,
  type BlockKind,
} from "@/lib/content/markdown-blocks";
import { cn } from "@/lib/utils/cn";
import { parseYouTubeId, videoLinkHost } from "@/lib/utils/youtube";

// Hybrid editor: prose is rich text, while semantic content types stay as
// separate cards. Storage remains markdown; see markdown-blocks.ts for the
// untouched-block byte-fidelity guarantee and rich-text.ts for inline styles.
//
// Заход «Редактор блоков» — шесть правок по жалобам владельца:
//   • вставка идёт в предсказуемое место (после блока в фокусе или в выбранный
//     промежуток), а не всегда в конец документа;
//   • у кода и врезки настройка живёт в ШАПКЕ блока, а не отдельной строкой над
//     полем — селект дублировал заголовок и занимал высоту;
//   • поля тянутся по содержимому (код — моноширинный);
//   • шапка одинаковая у всех блоков: слева иконка+тип, справа перемещение,
//     дублирование, удаление;
//   • удаление спрашивает подтверждение и даёт «Вернуть» в тосте;
//   • пустой блок, добавленный и брошенный, не сохраняется как пустая директива.

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
  spoiler: { label: "Скрытый ответ", icon: EyeOff },
  question: { label: "Вопрос из банка", icon: ListChecks },
};

// Заход C.4: превью блока «Видео» разбирает ссылку тем же `parseYouTubeId`, что и
// сам плеер. Прежняя локальная регулярка была ЧУТЬ другой (без `/shorts/` и
// `/live/`), то есть редактор мог обещать превью там, где плеер бы его не дал —
// и наоборот. Второго определения «это YouTube» на платформе больше нет.
const youtubeId = parseYouTubeId;

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

/**
 * Поле, которое тянется по содержимому. Раньше у кода стояло фиксированное
 * `rows={6}`: короткий сниппет держал пустоту, длинный прятался в скролл.
 */
function AutoTextarea({
  value,
  onChange,
  onBlur,
  ariaLabel,
  mono = false,
  min = 3,
  max = 24,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  ariaLabel: string;
  mono?: boolean;
  min?: number;
  max?: number;
}) {
  const rows = Math.min(max, Math.max(min, value.split("\n").length));
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      rows={rows}
      spellCheck={!mono}
      aria-label={ariaLabel}
      className={cn(
        "rounded-control border-border bg-surface-2 text-text-1 ease-app hover:border-border-strong focus:border-accent w-full resize-y border p-3 text-[14px] leading-relaxed transition-colors duration-150 outline-none",
        mono && "font-mono text-[13px]",
      )}
    />
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

/** Пустой блок — тот, у которого нечего сохранять (см. dropIfEmpty). */
function isEmptyBlock(block: Block): boolean {
  switch (block.kind) {
    case "video":
      return block.url.trim() === "" && block.title.trim() === "";
    case "question":
      // Директива без id вопроса — пустая плашка у ученика.
      return block.questionId.trim() === "";
    case "spoiler":
      return block.body.trim() === "" && block.title.trim() === "";
    case "mock":
    case "table":
      // Мок — маркер без тела; таблицу с пустыми ячейками ментор мог завести
      // осознанно, под заполнение позже.
      return false;
    default:
      return block.body.trim() === "";
  }
}

const HEADER_BUTTON =
  "text-text-3 hover:text-text-1 ease-app flex size-11 shrink-0 items-center justify-center rounded-[6px] transition-colors duration-150 disabled:opacity-30 md:size-8";

function BlockCard({
  block,
  index,
  total,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
  onBlurBlock,
}: {
  block: Block;
  index: number;
  total: number;
  onChange: (next: Block) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (delta: number) => void;
  onBlurBlock: () => void;
}) {
  const meta = KIND_META[block.kind];
  const callout = block.kind === "callout" ? CALLOUT_META[block.variant] : undefined;
  const Icon = callout?.icon ?? meta.icon;
  const tone = callout?.tone;
  const [confirming, setConfirming] = useState(false);

  // Удаление спрашивает подтверждение вторым кликом (диалог здесь дрался бы с
  // раскладкой карточки), а вернуть блок можно из тоста — см. BlockEditor.
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
      <div className="border-border flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
        <Icon
          size={15}
          strokeWidth={1.75}
          className="shrink-0"
          style={tone ? { color: tone } : undefined}
          aria-hidden="true"
        />
        <span className="text-text-2 text-[12px] font-medium">
          {block.kind === "callout" ? (callout?.label ?? "Врезка") : meta.label}
        </span>

        {/* Настройка блока живёт в шапке: у врезки — компактный сегмент типов
            (раньше громоздкий селект дублировал заголовок), у кода — язык. */}
        {block.kind === "callout" && (
          <div
            role="group"
            aria-label="Тип врезки"
            className="rounded-control border-border ml-1 inline-flex items-center border p-0.5"
          >
            {Object.entries(CALLOUT_META).map(([key, m]) => {
              const active = block.variant === key;
              const VariantIcon = m.icon;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={m.label}
                  title={m.label}
                  aria-pressed={active}
                  onClick={() => onChange(withEdit(block, { variant: key }))}
                  className={cn(
                    "ease-app flex size-7 items-center justify-center rounded-[6px] transition-colors duration-150",
                    active ? "bg-surface-2" : "text-text-3 hover:text-text-1",
                  )}
                  style={active ? { color: m.tone } : undefined}
                >
                  <VariantIcon size={14} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        )}

        {block.kind === "code" && (
          <Select
            value={block.lang || "text"}
            onValueChange={(value) => onChange(withEdit(block, { lang: value }))}
          >
            <SelectTrigger className="ml-1 h-7 w-32" aria-label="Язык кода">
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
        )}

        {block.kind === "mock" && (
          <Select
            value={block.variant}
            onValueChange={(value) => onChange(withEdit(block, { variant: value }))}
          >
            <SelectTrigger className="ml-1 h-7 w-36" aria-label="Тип мока">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="legend">По легенде</SelectItem>
              <SelectItem value="theory">ML-теория</SelectItem>
            </SelectContent>
          </Select>
        )}

        <span className="flex-1" />

        <button
          type="button"
          aria-label="Выше"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          className={HEADER_BUTTON}
        >
          <ChevronUp size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Ниже"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          className={HEADER_BUTTON}
        >
          <ChevronDown size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-label="Дублировать блок"
          onClick={onDuplicate}
          className={HEADER_BUTTON}
        >
          <Copy size={14} strokeWidth={1.75} />
        </button>
        {confirming && (
          <span className="text-danger shrink-0 text-[12px] font-medium">Удалить?</span>
        )}
        <button
          type="button"
          aria-label={confirming ? "Подтвердить удаление блока" : "Удалить блок"}
          onClick={confirmRemove}
          className={cn(
            HEADER_BUTTON,
            "hover:text-danger",
            confirming && "text-danger bg-danger/12",
          )}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {block.kind === "callout" && (
          <AutoTextarea
            value={block.body}
            onChange={(body) => onChange(withEdit(block, { body }))}
            onBlur={onBlurBlock}
            ariaLabel="Текст врезки"
          />
        )}

        {block.kind === "code" && (
          <AutoTextarea
            value={block.body}
            onChange={(body) => onChange(withEdit(block, { body }))}
            onBlur={onBlurBlock}
            ariaLabel="Код"
            mono
            min={2}
          />
        )}

        {block.kind === "math" && (
          <div className="grid gap-2 md:grid-cols-2">
            <AutoTextarea
              value={block.body}
              onChange={(body) => onChange(withEdit(block, { body }))}
              onBlur={onBlurBlock}
              ariaLabel="Формула (KaTeX)"
              mono
              min={2}
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
                onBlur={onBlurBlock}
                placeholder="https://youtu.be/…"
                aria-label="Ссылка на видео"
              />
              <Input
                value={block.title}
                onChange={(e) => onChange(withEdit(block, { title: e.target.value }))}
                onBlur={onBlurBlock}
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
              ) : block.url.trim() ? (
                // Ссылка есть, но плеер её не встроит — говорим об этом ментору
                // здесь, а не оставляем ученику пустое место (заход C.4).
                <span className="text-warning px-3 text-center text-[12px]">
                  Плеер поддерживает только YouTube. Эта ссылка откроется у ученика кнопкой «Открыть
                  видео» в новой вкладке
                  {videoLinkHost(block.url.trim()) ? ` (${videoLinkHost(block.url.trim())})` : ""}
                </span>
              ) : (
                <span className="text-text-3 px-3 text-center text-[12px]">
                  Вставь ссылку YouTube — покажу превью
                </span>
              )}
            </div>
          </div>
        )}

        {block.kind === "spoiler" && (
          <>
            <Input
              value={block.title}
              onChange={(e) => onChange(withEdit(block, { title: e.target.value }))}
              onBlur={onBlurBlock}
              placeholder="Вопрос — его ученик видит всегда"
              aria-label="Заголовок скрытого ответа"
            />
            <AutoTextarea
              value={block.body}
              onChange={(body) => onChange(withEdit(block, { body }))}
              onBlur={onBlurBlock}
              ariaLabel="Скрытый ответ"
            />
            <p className="text-text-3 text-[12px]">
              Ученик видит заголовок и кнопку «Показать ответ»; тело разворачивается по клику.
            </p>
          </>
        )}

        {block.kind === "question" && <QuestionBlockField block={block} onChange={onChange} />}

        {block.kind === "practice" && (
          <AutoTextarea
            value={block.body}
            onChange={(body) => onChange(withEdit(block, { body }))}
            onBlur={onBlurBlock}
            ariaLabel="Содержимое блока практики"
          />
        )}

        {block.kind === "table" && <TableGrid block={block} onChange={onChange} />}

        {block.kind === "prose" &&
          (block.editable ? (
            <RichTextEditor
              value={block.body}
              onChange={(body) => onChange(withEdit(block, { body }))}
              onBlur={onBlurBlock}
              ariaLabel="Текст урока"
            />
          ) : (
            <>
              <p className="text-warning text-[12px]">
                Этот фрагмент содержит нестандартную Markdown-разметку. Он оставлен в исходном виде,
                чтобы не повредить старый урок.
              </p>
              <AutoTextarea
                value={block.body}
                onChange={(body) => onChange(withEdit(block, { body }))}
                onBlur={onBlurBlock}
                ariaLabel="Нестандартный Markdown"
                max={14}
              />
            </>
          ))}
      </div>
    </div>
  );
}

/**
 * Поле блока «Вопрос из банка» (заход B.1, блок 2.4). id ментор не набирает —
 * он выбирает вопрос поиском; в карточке видно текст выбранного вопроса, а не
 * cuid, иначе блок нечитаем.
 */
function QuestionBlockField({
  block,
  onChange,
}: {
  block: Block;
  onChange: (next: Block) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [row, setRow] = useState<QuizPickerRow | null>(null);
  // Стартуем в «загружаю», если id уже есть: иначе первый кадр (в т.ч. SSR
  // редактора) показывал бы «вопрос не найден» на совершенно рабочем вопросе.
  const [loading, setLoading] = useState(block.questionId.trim() !== "");
  const id = block.questionId.trim();

  useEffect(() => {
    if (!id) {
      setRow(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void lookupQuizQuestionAction(id).then((result) => {
      if (cancelled) return;
      setLoading(false);
      setRow(result?.ok ? result.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="flex flex-col gap-2">
      {id ? (
        <div className="rounded-control border-border bg-surface-2 border px-3 py-2 text-[13px]">
          {loading ? (
            <span className="text-text-3">Загружаю вопрос…</span>
          ) : row ? (
            <>
              <span className="block">{row.teaser}</span>
              <span className="text-text-3 mt-0.5 block text-[12px]">
                {row.category} · {row.type}
              </span>
            </>
          ) : (
            // Тот же край, что у ученика (2.3): вопрос удалён из банка, а
            // директива осталась — ментор должен видеть причину, а не пустоту.
            <span className="text-warning">
              Вопрос не найден в банке — выбери другой, иначе ученик увидит заглушку.
            </span>
          )}
        </div>
      ) : (
        <p className="text-text-3 text-[13px]">Вопрос ещё не выбран.</p>
      )}
      <div>
        <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
          {id ? "Заменить вопрос" : "Выбрать вопрос"}
        </Button>
      </div>
      <p className="text-text-3 text-[12px]">
        Вопрос отвечается прямо в тексте: варианты перемешиваются, проверка серверная. Если он же
        привязан к уроку ролью «в квизе», внизу в «Проверь себя» он больше не повторится.
      </p>
      <QuestionBankPicker
        open={picking}
        onOpenChange={setPicking}
        onPick={(picked) => {
          setRow(picked);
          onChange(withEdit(block, { questionId: picked.id }));
        }}
      />
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

type NewBlockTemplate = {
  kind: BlockKind;
  label: string;
  variant?: string;
  body?: string;
  title?: string;
};

const NEW_BLOCKS: NewBlockTemplate[] = [
  { kind: "prose", label: "Текст", body: "Новый абзац." },
  {
    kind: "spoiler",
    label: "Скрытый ответ",
    title: "Как ты думаешь, почему?",
    body: "Ответ, который открывается по клику.",
  },
  { kind: "question", label: "Вопрос из банка" },
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

function makeBlock(template: NewBlockTemplate): Block {
  newIdCounter += 1;
  const seed: Block = {
    id: `new${newIdCounter}`,
    kind: template.kind,
    raw: "",
    body: template.body ?? "",
    variant: template.variant ?? "",
    lang: template.kind === "code" ? "python" : "",
    url: "",
    title: template.title ?? "",
    questionId: "",
    editable: true,
    dirty: true,
    eol: "\n",
  };
  if (template.kind === "table")
    seed.body = "| Колонка | Колонка |\n| --- | --- |\n| Ячейка | Ячейка |\n";
  if (template.kind === "prose") seed.body = `${template.body ?? ""}\n\n`;
  seed.raw = renderBlock(seed);
  return seed;
}

function BlockPalette({
  templates,
  onPick,
  className,
  labelled = false,
}: {
  templates: NewBlockTemplate[];
  onPick: (template: NewBlockTemplate) => void;
  className?: string;
  labelled?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {labelled && (
        <span className="text-text-3 text-[11px] font-medium tracking-wide uppercase">
          Тип контента
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {templates.map((template) => (
          <Button
            key={template.label}
            variant="secondary"
            size="sm"
            onClick={() => onPick(template)}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            {template.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Тонкая зона между блоками: наводишь — появляется «+», клик раскрывает палитру
 * ровно для этого промежутка. Без неё вставка всегда падала в конец документа и
 * блок приходилось гнать стрелками через весь урок.
 */
function InsertGap({
  open,
  onToggle,
  templates,
  onPick,
}: {
  open: boolean;
  onToggle: () => void;
  templates: NewBlockTemplate[];
  onPick: (template: NewBlockTemplate) => void;
}) {
  return (
    <div className="group/gap flex flex-col">
      {/* На тач-экране ховера нет — там зона видна всегда; на десктопе она
          проявляется по наведению, чтобы не рябить между блоками. */}
      <button
        type="button"
        aria-expanded={open}
        aria-label="Вставить блок сюда"
        onClick={onToggle}
        className="ease-app flex h-5 items-center justify-center opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/gap:opacity-100 md:focus-visible:opacity-100"
      >
        <span className="bg-border h-px flex-1" />
        <span className="border-border text-text-3 bg-surface-1 mx-2 flex size-5 items-center justify-center rounded-full border">
          <Plus size={12} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="bg-border h-px flex-1" />
      </button>
      {open && (
        <BlockPalette
          templates={templates}
          onPick={onPick}
          className="rounded-card border-border bg-surface-2 mb-2 border p-2"
        />
      )}
    </div>
  );
}

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
  const [openGap, setOpenGap] = useState<number | null>(null);
  // Блок, с которым ментор работал последним: кнопки сверху вставляют СРАЗУ ЗА
  // ним, а не в конец документа.
  const focused = useRef<number | null>(null);

  const commit = (next: Block[]) => {
    setBlocks(next);
    onChange(serialize(next));
  };

  // В гайде нет ни мока, ни квиза: ответ вопроса пишется в `quiz_answers` с
  // lesson_id, а у гайда его нет — вопрос там отвечать негде.
  const available = NEW_BLOCKS.filter(
    (b) => zone === "lesson" || (b.kind !== "mock" && b.kind !== "question"),
  );

  const insertAt = (template: NewBlockTemplate, index: number) => {
    const seed = makeBlock(template);
    const next = [...blocks.slice(0, index), seed, ...blocks.slice(index)];
    focused.current = index;
    setOpenGap(null);
    commit(next);
  };

  const removeAt = (index: number) => {
    const victim = blocks[index];
    if (!victim) return;
    const next = blocks.filter((_, i) => i !== index);
    focused.current = null;
    commit(next);
    // Автосейв редактора сработает через секунду, поэтому «Вернуть» — не
    // косметика: это единственный способ отыграть случайное удаление.
    toast({
      title: "Блок удалён",
      action: {
        label: "Вернуть",
        onClick: () => {
          setBlocks((current) => {
            const restored = [...current.slice(0, index), victim, ...current.slice(index)];
            onChange(serialize(restored));
            return restored;
          });
        },
      },
    });
  };

  /**
   * Пустой блок, добавленный и брошенный, не сохраняется: иначе в markdown
   * оседает `:::callout{...}\n\n:::` без текста, а у ученика — пустая цветная
   * плашка. DECISION: правило работает только для блоков, заведённых в этой
   * сессии (`id` начинается с `new`) — молча удалять уже существующий блок,
   * который ментор временно очистил, было бы хуже бага.
   */
  const dropIfEmpty = (index: number) => {
    const block = blocks[index];
    if (!block || !block.id.startsWith("new") || !isEmptyBlock(block)) return;
    commit(blocks.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-3">
      <BlockPalette
        templates={available}
        labelled
        onPick={(template) =>
          insertAt(template, focused.current === null ? blocks.length : focused.current + 1)
        }
      />

      {blocks.length === 0 ? (
        <p className="text-text-3 text-[13px]">Пусто — добавь первый блок кнопками выше.</p>
      ) : (
        <div className="flex flex-col">
          {blocks.map((block, index) => (
            <div key={block.id} className="flex flex-col">
              <InsertGap
                open={openGap === index}
                onToggle={() => setOpenGap(openGap === index ? null : index)}
                templates={available}
                onPick={(template) => insertAt(template, index)}
              />
              <div onFocusCapture={() => (focused.current = index)}>
                <BlockCard
                  block={block}
                  index={index}
                  total={blocks.length}
                  onChange={(next) => commit(blocks.map((b, i) => (i === index ? next : b)))}
                  onRemove={() => removeAt(index)}
                  onDuplicate={() => {
                    newIdCounter += 1;
                    const copy: Block = { ...block, id: `new${newIdCounter}`, dirty: true };
                    commit([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]);
                  }}
                  onMove={(delta) => {
                    const target = index + delta;
                    if (target < 0 || target >= blocks.length) return;
                    const next = [...blocks];
                    [next[index], next[target]] = [next[target]!, next[index]!];
                    focused.current = target;
                    commit(next);
                  }}
                  onBlurBlock={() => dropIfEmpty(index)}
                />
              </div>
            </div>
          ))}
          <InsertGap
            open={openGap === blocks.length}
            onToggle={() => setOpenGap(openGap === blocks.length ? null : blocks.length)}
            templates={available}
            onPick={(template) => insertAt(template, blocks.length)}
          />
        </div>
      )}
    </div>
  );
}
