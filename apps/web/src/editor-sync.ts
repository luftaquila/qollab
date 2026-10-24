// Text anchors shared by the visual editor, source editor and web preview.
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

export interface SyncAnchor {
  /** Text runs of the block at the anchor; chips, math and table cells end a run. */
  runs: string[];
  /** The run and the offset in it where the anchor is. */
  run: number;
  offset: number;
  /** Text of the nearest blocks before and after, nearest first. */
  before: string[];
  after: string[];
  /** Position in the document (0–1), to choose among repeated text. */
  order: number;
  /** Height of the anchor in the editor's viewport (0–1). */
  ratio: number;
}

// Spaces, soft hyphens, zero-width characters and dashes differ between the
// source and the rendered document (line breaks, hyphenation, `--` as –).
const IGNORED = /[\s­​-‍⁠﻿‐-―−-]/u;
function normalizeChar(c: string) {
  let out = "";
  for (const ch of c.normalize("NFKC")) {
    if (IGNORED.test(ch)) continue;
    out +=
      ch === "‘" || ch === "’"
        ? "'"
        : ch === "“" || ch === "”"
          ? '"'
          : ch.toLowerCase();
  }
  return out;
}
export const normalize = (text: string) => Array.from(text, normalizeChar).join("");

/** The text a line of LaTeX prints, cell by cell (tables, raw blocks). */
function latexRuns(line: string) {
  return line
    .replace(/(?<!\\)%.*$/, "")
    .replace(/\\\\/g, "&")
    .replace(/\\([&%#_$])/g, (_, c: string) => (c === "&" ? "\u0001" : c))
    .replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?/g, "&")
    .replace(/[{}$^_~]/g, "")
    .split("&")
    .map((cell) => normalize(cell.replace(/\u0001/g, "&")))
    .filter((cell) => cell.length > 0);
}
const isFrontMatter = (node: PMNode) =>
  node.type.name === "qollab_raw" && /^---\r?\n/.test(node.textContent);
const isTarget = (node: PMNode) =>
  (node.isTextblock && !isFrontMatter(node)) || node.type.name === "image-block";

/** Text runs of a block and where `cut` (an offset in it, or -1) falls. */
function blockRuns(node: PMNode, cut: number) {
  if (node.type.name === "image-block")
    return { runs: [normalize(String(node.attrs.caption || node.attrs.alt || ""))], run: 0, offset: 0 };
  if (node.type.name === "qollab_raw") {
    const text = node.textContent,
      at = Math.max(0, cut),
      lineStart = text.lastIndexOf("\n", at - 1) + 1,
      lineEnd = text.indexOf("\n", at);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const head = latexRuns(line.slice(0, at - lineStart));
    // Lines around the cursor stand in when its own line prints nothing.
    const lines = text.split("\n").flatMap(latexRuns);
    const runs = latexRuns(line);
    if (runs.length)
      return { runs, run: Math.max(0, head.length - 1), offset: head.length ? head[head.length - 1].length : 0 };
    return { runs: lines.length ? lines : [""], run: 0, offset: 0 };
  }
  const runs = [""];
  let run = 0,
    offset = 0;
  node.forEach((child, start) => {
    if (child.isText) {
      if (cut >= start && cut <= start + child.nodeSize) {
        run = runs.length - 1;
        offset = runs[run].length + normalize(child.text!.slice(0, cut - start)).length;
      }
      runs[runs.length - 1] += normalize(child.text!);
    } else if (child.type.name !== "hardbreak") {
      // A chip or formula renders differently from source: it ends a run.
      if (cut >= start && cut < start + child.nodeSize) {
        run = runs.length - 1;
        offset = runs[run].length;
      }
      runs.push("");
    }
  });
  return { runs, run, offset };
}
/** The block at a document position: its node, start and the offset in it. */
function blockAt(doc: PMNode, pos: number) {
  const $pos = doc.resolve(pos);
  if ($pos.parent.isTextblock && !isFrontMatter($pos.parent))
    return { node: $pos.parent, start: $pos.before(), cut: $pos.parentOffset };
  let found: { node: PMNode; start: number; cut: number } | undefined;
  doc.nodesBetween(pos, Math.min(doc.content.size, pos + 4000), (node, start) => {
    if (found) return false;
    if (start >= pos && isTarget(node)) found = { node, start, cut: -1 };
    return !found && !node.isTextblock;
  });
  return found;
}
/** Text of up to three blocks before and after a block, nearest first. */
function neighbours(doc: PMNode, from: number, to: number) {
  const before: string[] = [],
    after: string[] = [];
  doc.nodesBetween(Math.max(0, from - 6000), from, (node, start) => {
    if (start + node.nodeSize <= from && isTarget(node)) {
      const runs = blockRuns(node, -1).runs.filter((r) => r.length >= 4);
      if (runs.length) before.unshift(runs[runs.length - 1]);
      return false;
    }
    return !node.isTextblock;
  });
  doc.nodesBetween(to, Math.min(doc.content.size, to + 6000), (node, start) => {
    if (after.length >= 3) return false;
    if (start >= to && isTarget(node)) {
      const runs = blockRuns(node, -1).runs.filter((r) => r.length >= 4);
      if (runs.length) after.push(runs[0]);
      return false;
    }
    return !node.isTextblock;
  });
  return { before: before.slice(0, 3), after };
}
/**
 * Where the reader is in the editor. `cursor` prefers the selection; otherwise
 * the cursor counts only while it is on screen.
 */
export function editorAnchor(
  view: EditorView,
  scroller: HTMLElement,
  cursor: boolean,
): SyncAnchor | null {
  const box = scroller.getBoundingClientRect();
  if (!box.height) return null;
  const { doc, selection } = view.state;
  let pos = selection.head,
    top: number | undefined;
  try {
    const coords = view.coordsAtPos(pos);
    if (coords.bottom >= box.top && coords.top <= box.bottom) top = coords.top;
  } catch {
    /* A position without a DOM box; use the reading line. */
  }
  if (top === undefined || (!cursor && !view.hasFocus())) {
    const content = view.dom.getBoundingClientRect(),
      line = box.top + box.height * 0.3;
    const hit = view.posAtCoords({ left: content.left + Math.min(80, content.width / 2), top: line });
    if (!hit) return null;
    pos = hit.pos;
    top = line;
  }
  return anchorAt(doc, pos, (top - box.top) / box.height);
}
/** The anchor for a document position shown at `ratio` of the editor's height. */
export function anchorAt(doc: PMNode, pos: number, ratio: number): SyncAnchor | null {
  const block = blockAt(doc, pos);
  if (!block) return null;
  const { runs, run, offset } = blockRuns(block.node, block.cut);
  return {
    runs,
    run,
    offset,
    ...neighbours(doc, block.start, block.start + block.node.nodeSize),
    order: doc.content.size ? block.start / doc.content.size : 0,
    ratio,
  };
}

/** The text a Markdown line prints; chips, math and commands end a run. */
function markdownRuns(line: string) {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+)*/, "")
    .replace(/\s*\{[#.][^}]*\}/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\textcolor(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\$\$?[^$]*\$\$?|\\[a-zA-Z]+(?:\{[^}]*\})?/g, "\u0002")
    .replace(/\\(.)/g, "$1")
    .replace(/[*_`[\]{}<>]/g, "")
    .split("\u0002")
    .map(normalize)
    .filter((run) => run.length > 0);
}
/**
 * The anchor for a line of a Markdown source shown at `ratio` of the editor's
 * height; LaTeX blocks read as LaTeX, the front matter as nothing.
 */
export function sourceAnchor(lines: string[], line: number, column: number, ratio: number): SyncAnchor | null {
  const runsOf: string[][] = [];
  let fence = "",
    yaml = lines[0] === "---";
  lines.forEach((text, i) => {
    if (yaml) {
      runsOf.push([]);
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(text)) yaml = false;
      return;
    }
    const f = /^\s*(`{3,}|~{3,})/.exec(text);
    if (f) {
      fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? "" : fence) : f[1];
      runsOf.push([]);
    } else runsOf.push(fence ? latexRuns(text) : markdownRuns(text));
  });
  const runs = runsOf[line] ?? [];
  if (!runs.length) return null;
  const text = lines[line],
    head = (fence ? latexRuns : markdownRuns)(text.slice(0, column));
  const before: string[] = [],
    after: string[] = [];
  for (let i = line - 1; i >= 0 && before.length < 3; i--)
    if (runsOf[i].length) before.push(runsOf[i][runsOf[i].length - 1]);
  for (let i = line + 1; i < lines.length && after.length < 3; i++)
    if (runsOf[i].length) after.push(runsOf[i][0]);
  const run = Math.max(0, Math.min(runs.length - 1, head.length - 1));
  return {
    runs,
    run,
    offset: head.length ? Math.min(head[head.length - 1].length, runs[run].length) : 0,
    before,
    after,
    order: lines.length ? line / lines.length : 0,
    ratio,
  };
}
