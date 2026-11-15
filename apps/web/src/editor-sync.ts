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
  /** Height of the anchor in the editor's viewport (0–1, beyond it off screen). */
  ratio: number;
  /**
   * While scrolling no single place is shown: `line` is the height of the
   * viewport to match and `around` the blocks next to this one, so the preview
   * moves in proportion between the nearest block above and below the line.
   */
  line?: number;
  around?: SyncAnchor[];
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
/** Punctuation alone is found anywhere: only text with a letter or digit names a place. */
export const worded = (text: string) => /[\p{L}\p{N}]/u.test(text);

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
    .filter(worded);
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
  let run = -1,
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
  // Away from a cursor the block stands for its first text of some length.
  if (run < 0) run = runs.findIndex((text) => text.length >= 4);
  if (run < 0) run = Math.max(0, runs.findIndex((text) => text.length > 0));
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
/** The blocks of the document around a position, nearest first. */
function blocksAround(doc: PMNode, pos: number, before: number, after: number) {
  const above: { node: PMNode; start: number }[] = [],
    below: { node: PMNode; start: number }[] = [];
  doc.nodesBetween(Math.max(0, pos - 6000), pos, (node, start) => {
    if (start + node.nodeSize <= pos && isTarget(node)) {
      above.unshift({ node, start });
      return false;
    }
    return !node.isTextblock;
  });
  doc.nodesBetween(pos, Math.min(doc.content.size, pos + 6000), (node, start) => {
    if (below.length >= after) return false;
    if (start >= pos && isTarget(node)) {
      below.push({ node, start });
      return false;
    }
    return !node.isTextblock;
  });
  return { above: above.slice(0, before), below };
}
/** Where the first node that ends below a height of the viewport starts. */
function nodeBelow(view: EditorView, y: number) {
  let parent = view.state.doc,
    inside = 0;
  for (;;) {
    const starts: number[] = [];
    parent.forEach((_, offset) => starts.push(inside + offset));
    // Children follow each other down the page, so their bottoms are sorted.
    let low = 0,
      high = starts.length;
    while (low < high) {
      const middle = (low + high) >> 1,
        dom = view.nodeDOM(starts[middle]);
      if (dom instanceof HTMLElement && dom.getBoundingClientRect().bottom > y) high = middle;
      else low = middle + 1;
    }
    if (low === starts.length) return inside + parent.content.size;
    const child = parent.child(low);
    if (child.isTextblock || !child.childCount) return starts[low];
    parent = child;
    inside = starts[low] + 1;
  }
}
/** The top of a block's text in the viewport; a figure's text is its caption. */
function blockTop(view: EditorView, node: PMNode, start: number) {
  try {
    if (node.isTextblock) return view.coordsAtPos(start + 1).top;
    const dom = view.nodeDOM(start);
    if (!(dom instanceof HTMLElement)) return undefined;
    const caption = dom.querySelector(".caption-input")?.getBoundingClientRect();
    return caption?.height ? caption.top : dom.getBoundingClientRect().top;
  } catch {
    return undefined;
  }
}
/**
 * The height of an editor's viewport that the preview matches, given where the
 * cursor is: the cursor's own while it is well on screen, otherwise the nearest
 * such height. Scrolling the cursor away thus moves the matched line to the
 * edge it left through, and the preview moves with the editor without a step.
 */
export function syncLine(cursor: number | undefined) {
  return cursor === undefined ? 0.3 : Math.max(0.05, Math.min(0.9, cursor));
}
/**
 * Where the reader is in the editor: at the cursor while it is on the matched
 * line (`cursor` says it just moved; otherwise the editor must have the
 * focus), else at the blocks around that line.
 */
export function editorAnchor(
  view: EditorView,
  scroller: HTMLElement,
  cursor: boolean,
): SyncAnchor | null {
  const box = scroller.getBoundingClientRect();
  if (!box.height) return null;
  const { doc, selection } = view.state,
    ratio = (top: number) => (top - box.top) / box.height;
  let head: number | undefined;
  try {
    head = ratio(view.coordsAtPos(selection.head).top);
  } catch {
    /* A position without a DOM box. */
  }
  const line = syncLine(head);
  if (line === head && (cursor || view.hasFocus())) return anchorAt(doc, selection.head, line);
  // The blocks around the line, down to the second one that starts below it
  // (cells of one table row start at the same height).
  const y = box.top + box.height * line,
    { above, below } = blocksAround(doc, nodeBelow(view, y), 2, 8),
    points: SyncAnchor[] = [];
  let under = 0;
  for (const block of [...above, ...below]) {
    if (under === 2) break;
    const top = blockTop(view, block.node, block.start);
    if (top === undefined) continue;
    if (top > y) under++;
    points.push(describe(doc, { ...block, cut: -1 }, ratio(top)));
  }
  if (!points.length) return null;
  return { ...points[0], line, around: points.slice(1) };
}
/** A block as an anchor shown at `ratio` of the editor's height. */
function describe(doc: PMNode, block: { node: PMNode; start: number; cut: number }, ratio: number): SyncAnchor {
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
/** The anchor for a document position shown at `ratio` of the editor's height. */
export function anchorAt(doc: PMNode, pos: number, ratio: number): SyncAnchor | null {
  const block = blockAt(doc, pos);
  return block ? describe(doc, block, ratio) : null;
}

/** The text a Markdown line prints; chips, math and commands end a run. */
function markdownRuns(line: string) {
  // A table row prints its cells, the rule under its head row nothing.
  return (/^\s*\|/.test(line) ? line.replace(/(?<!\\)\|/g, "\u0002") : line)
    .replace(/^\s*(?:#{1,6}\s+|>\s?|(?:[-*+]|\d+[.)])\s+)*/, "")
    .replace(/\s*\{[#.][^}]*\}/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\\textcolor(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\$\$?[^$]*\$\$?|\\[a-zA-Z]+(?:\{[^}]*\})?/g, "\u0002")
    .replace(/\\(.)/g, "$1")
    .replace(/[*_`[\]{}<>]/g, "")
    .split("\u0002")
    .map(normalize)
    .filter(worded);
}
/** A Markdown source as the text each line prints. */
export interface SourceText {
  lines: string[];
  runs: string[][];
  /** Lines inside a fenced block, which read as LaTeX. */
  raw: boolean[];
}
/** Reads a Markdown source: LaTeX blocks as LaTeX, the front matter as nothing. */
export function readSource(lines: string[]): SourceText {
  const runs: string[][] = [],
    raw: boolean[] = [];
  let fence = "",
    yaml = lines[0] === "---";
  lines.forEach((text, i) => {
    raw.push(false);
    if (yaml) {
      runs.push([]);
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(text)) yaml = false;
      return;
    }
    const f = /^\s*(`{3,}|~{3,})/.exec(text);
    if (f) {
      fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? "" : fence) : f[1];
      runs.push([]);
    } else {
      raw[i] = !!fence;
      runs.push(fence ? latexRuns(text) : markdownRuns(text));
    }
  });
  return { lines, runs, raw };
}
/** The anchor for a place in a source line shown at `ratio` of the editor's height. */
export function sourceAnchor(source: SourceText, line: number, column: number, ratio: number): SyncAnchor | null {
  const runs = source.runs[line] ?? [];
  if (!runs.length) return null;
  const head = (source.raw[line] ? latexRuns : markdownRuns)(source.lines[line].slice(0, column));
  const before: string[] = [],
    after: string[] = [];
  for (let i = line - 1; i >= 0 && before.length < 3; i--) {
    const near = source.runs[i];
    if (near.length) before.push(near[near.length - 1]);
  }
  for (let i = line + 1; i < source.lines.length && after.length < 3; i++)
    if (source.runs[i].length) after.push(source.runs[i][0]);
  const run = Math.max(0, Math.min(runs.length - 1, head.length - 1));
  return {
    runs,
    run,
    offset: head.length ? Math.min(head[head.length - 1].length, runs[run].length) : 0,
    before,
    after,
    order: source.lines.length ? line / source.lines.length : 0,
    ratio,
  };
}
