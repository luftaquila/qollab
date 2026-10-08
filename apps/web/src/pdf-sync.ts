// Editor → PDF scroll sync. The editor sends the text where the reader is (the
// cursor while it is on screen, otherwise the line 30% down the editor) and
// the PDF panel finds that text among the PDF's text items. Matching text
// rather than scroll proportions keeps working where figures, tables or page
// breaks take different room in the editor and in the PDF.
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { PDFDocumentProxy } from "pdfjs-dist";

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
// source and the PDF (line breaks, hyphenation, `--` written as –).
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

// --- Editor side -------------------------------------------------------------

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
      // A chip or formula prints differently in the PDF: it ends a run.
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

// --- PDF side ----------------------------------------------------------------

export interface TextBox {
  page: number;
  /** In PDF points from the page's top-left corner. */
  top: number;
  bottom: number;
}
export interface TextIndex {
  /** Normalized text of the whole PDF. */
  text: string;
  /** For every character of `text`, its box in `boxes`. */
  owner: Int32Array;
  boxes: TextBox[];
}
/** Reads the text and positions of every page; null when `alive` turns false. */
export async function indexPdf(pdf: PDFDocumentProxy, alive: () => boolean) {
  let text = "";
  const owner: number[] = [],
    boxes: TextBox[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    if (!alive()) return null;
    const viewport = page.getViewport({ scale: 1 });
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const n = normalize(item.str);
      if (!n) continue;
      const [, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const size = item.height || Math.hypot(item.transform[2], item.transform[3]) || 10;
      boxes.push({ page: p, top: baseline - size, bottom: baseline + size * 0.25 });
      text += n;
      for (let i = 0; i < n.length; i++) owner.push(boxes.length - 1);
    }
  }
  return { text, owner: Int32Array.from(owner), boxes } satisfies TextIndex;
}
export interface Located extends TextBox {
  /** Where in the index's text it was found, the hint for the next anchor. */
  at: number;
}
/**
 * The PDF line for an editor anchor, or null when its text is not found.
 * `hint` is where the previous anchor was found: scrolling moves gradually.
 */
export function locate(index: TextIndex, anchor: SyncAnchor, hint?: number): Located | null {
  const { text, owner, boxes } = index,
    length = text.length;
  if (!length) return null;
  const box = (i: number) => {
    const at = Math.max(0, Math.min(length - 1, i));
    return { ...boxes[owner[at]], at };
  };
  // Repeated text: prefer the copy whose neighbouring text matches the
  // editor's neighbouring blocks, then the one near the previous anchor and
  // at about the same place in the document.
  const score = (at: number) => {
    let s = Math.abs(at / length - anchor.order);
    if (hint !== undefined) s += Math.abs(at - hint) / length;
    for (let k = 0; k < 3; k++) {
      const previous = anchor.before[k]?.slice(-12);
      if (previous) {
        const i = text.lastIndexOf(previous, at);
        if (i >= 0 && at - i < 800 * (k + 1)) s -= 1 / (k + 1);
      }
      const next = anchor.after[k]?.slice(0, 12);
      if (next) {
        const i = text.indexOf(next, at);
        if (i >= 0 && i - at < 1600 * (k + 1)) s -= 1 / (k + 1);
      }
    }
    return s;
  };
  const find = (probe: string) => {
    let best = -1,
      bestScore = Infinity;
    for (let i = text.indexOf(probe); i >= 0; i = text.indexOf(probe, i + 1)) {
      const s = score(i);
      if (s < bestScore) [best, bestScore] = [i, s];
    }
    return best;
  };
  // Around the anchor in its own run, longest first.
  const run = anchor.runs[anchor.run] ?? "";
  for (const half of [24, 12, 6]) {
    // At a run's end the probe takes more text before the anchor.
    const from = Math.max(0, Math.min(anchor.offset - half, run.length - 2 * half)),
      probe = run.slice(from, from + 2 * half);
    if (probe.length < 6) continue;
    const i = find(probe);
    if (i >= 0) return box(i + anchor.offset - from);
  }
  // A short block ("팔 안전벨트"): the neighbours' text picks the right copy.
  if (run.length >= 2 && run.length < 6) {
    const i = find(run);
    if (i >= 0) return box(i + Math.min(anchor.offset, run.length - 1));
  }
  // The block's other text, nearest run first.
  const others = anchor.runs
    .map((r, k) => ({ r, d: Math.abs(k - anchor.run) }))
    .filter(({ r, d }) => d > 0 && r.length >= 6)
    .sort((a, b) => a.d - b.d);
  for (const { r } of others) {
    const i = find(r.slice(0, 24));
    if (i >= 0) return box(i);
  }
  // Nearby blocks: just after the previous one, or just before the next.
  for (let k = 0; k < 3; k++) {
    const previous = anchor.before[k];
    if (previous && previous.length >= 6) {
      const probe = previous.slice(-24),
        i = find(probe);
      if (i >= 0) return box(i + probe.length);
    }
    const next = anchor.after[k];
    if (next && next.length >= 6) {
      const i = find(next.slice(0, 24));
      if (i >= 0) return box(i);
    }
  }
  return null;
}
