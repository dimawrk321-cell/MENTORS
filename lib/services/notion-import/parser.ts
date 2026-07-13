// Notion markdown → structural tree (spec 7.14 п.1). Pure, DB-free, unit-tested.
//
// The spec assumed «4 пробела = уровень», but the real Notion export nests with
// 2-space steps and mixes irregular indents (numbered-list continuations sit at
// odd offsets). DECISION: the tree is built from RELATIVE indentation via a
// stack (a child has strictly greater indent than its parent) rather than a
// fixed step — this survives 2- or 4-space exports and the odd continuation
// lines. Structural nodes are whole-bold bullets `- **Title**`; module
// boundaries inside a track are whole-bold h2 headings `## **Title**` (the NLP
// track's «Простая мапа» / «ШАД»). Everything else is body content, sliced back
// from the original source range for a faithful, loss-free reconstruction.

export type NodeKind = "bullet" | "module-heading";

export interface ParsedNode {
  /** Inner text of the bold node (emphasis stripped, trimmed). */
  title: string;
  /** Leading-space count of the node's own line. */
  indent: number;
  /** 0-based source line index of the node line. */
  line: number;
  /** 0-based exclusive end of this node's subtree (next node with indent≤this). */
  endLine: number;
  kind: NodeKind;
  children: ParsedNode[];
}

export interface ParsedDoc {
  lines: string[];
  /** Top-level `- **Section**` nodes (indent 0). */
  roots: ParsedNode[];
}

const BULLET_RE = /^(\s*)[-*]\s+\*\*(.+?)\*\*\s*$/;
const MODULE_HEADING_RE = /^(\s*)##\s+\*\*(.+?)\*\*\s*$/;

/** Trims stray emphasis/markers left inside a captured bold title. */
function cleanTitle(raw: string): string {
  return raw.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

interface FlatNode {
  title: string;
  indent: number;
  line: number;
  kind: NodeKind;
  endLine: number;
}

export function parseNotionExport(markdown: string): ParsedDoc {
  const lines = markdown.split(/\r?\n/);
  const flat: FlatNode[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const bullet = BULLET_RE.exec(raw);
    if (bullet) {
      flat.push({
        title: cleanTitle(bullet[2]!),
        indent: bullet[1]!.length,
        line: i,
        kind: "bullet",
        endLine: lines.length,
      });
      continue;
    }
    const heading = MODULE_HEADING_RE.exec(raw);
    if (heading) {
      flat.push({
        title: cleanTitle(heading[2]!),
        indent: heading[1]!.length,
        line: i,
        kind: "module-heading",
        endLine: lines.length,
      });
    }
  }

  // Subtree span: the next node (doc order) whose indent ≤ this node's indent.
  for (let k = 0; k < flat.length; k += 1) {
    for (let j = k + 1; j < flat.length; j += 1) {
      if (flat[j]!.indent <= flat[k]!.indent) {
        flat[k]!.endLine = flat[j]!.line;
        break;
      }
    }
  }

  const roots: ParsedNode[] = [];
  const stack: ParsedNode[] = [];
  for (const item of flat) {
    const node: ParsedNode = { ...item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= node.indent) {
      stack.pop();
    }
    if (stack.length > 0) stack[stack.length - 1]!.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return { lines, roots };
}

/** Removes the common leading indentation from a block of lines. */
export function dedent(lines: string[]): string {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent < min) min = indent;
  }
  if (!Number.isFinite(min) || min === 0) return lines.join("\n");
  return lines.map((line) => (line.trim() === "" ? "" : line.slice(min))).join("\n");
}

/**
 * Raw body of a node: source lines strictly inside its subtree, dedented. For
 * leaf nodes (lessons, questions) this reproduces the original markdown of the
 * whole subtree — nested structural bullets included — with no parser loss.
 */
export function nodeBody(doc: ParsedDoc, node: ParsedNode): string {
  const body = doc.lines.slice(node.line + 1, node.endLine);
  return dedent(body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
