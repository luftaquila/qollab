import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Node as PMNode, Schema } from "@milkdown/kit/prose/model";
import { colors, texCommands, withoutLabels } from "./labels.js";
import { figureAttrs, figureMarkdown } from "./image.js";
import { nestedRawSpans } from "./raw.js";

// 2: labels (`[text]{#id}`, heading `{#id}`) and references (`@id`) as nodes.
// 3: underline (`[text]{.underline}`) and text color (`\textcolor`) marks.
export const SCHEMA_VERSION = 4;
export interface CodecRuntime {
  schema: Schema;
  parse: (source: string) => PMNode;
  serialize: (doc: PMNode) => string;
}
export interface Segment {
  key: string;
  source: string;
  before: string;
}
export interface Preservation {
  segments: Segment[];
  suffix: string;
  original: string;
  fingerprint: string;
}
export interface Decoded {
  doc: PMNode;
  preservation: Preservation;
  safe: boolean;
  reason?: string;
}
const parser = unified().use(remarkParse).use(remarkGfm);
const key = (node: PMNode) => JSON.stringify(node.toJSON());

// A figure alone in a paragraph (also inside a list item) decodes visually.
const FIGURE_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?!\[[^\]\n]*\]\([^\s)]+\)\{([^{}\n]*)\}[ \t]*$/;
function withoutFigures(text: string) {
  return text
    .split(/(\n[ \t]*\n)/)
    .map((chunk) => {
      const m = FIGURE_LINE.exec(chunk);
      return m && figureAttrs(m[1]) ? "" : chunk;
    })
    .join("");
}
// LaTeX commands with arguments stay text in the editor, but Markdown has read
// the backslash escapes in them (`\textbf{50\%}` holds `50%`), so writing the
// text back would change the LaTeX. A paragraph with both stays raw.
const OPAQUE = ["inlineCode", "inlineMath", "html"];
function escapedLatex(node: any, source: string): boolean {
  if (["paragraph", "heading", "tableCell"].includes(node.type)) {
    const { start, end } = node.position;
    let text = source.slice(start.offset, end.offset);
    const blank = (n: any) => {
      for (const child of n.children || []) {
        if (OPAQUE.includes(child.type)) {
          const from = child.position.start.offset - start.offset;
          const to = child.position.end.offset - start.offset;
          text = text.slice(0, from) + " ".repeat(to - from) + text.slice(to);
        } else blank(child);
      }
    };
    blank(node);
    // Math is read by LaTeX as written (this parser has no math syntax).
    text = text
      .replace(/(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$/g, "")
      .replace(colors(), "")
      .replace(texCommands(), "");
    return /\\[a-zA-Z]+\*?[[{]/.test(text) && /\\[!-/:-@[-`{-~]/.test(text);
  }
  return (node.children || []).some((child: any) => escapedLatex(child, source));
}
// A deliberately conservative boundary: unsupported inline syntax promotes its
// containing block to editable raw text. Never guess where malformed fences end.
function ranges(
  source: string,
): { start: number; end: number; raw: boolean }[] {
  const result: { start: number; end: number; raw: boolean }[] = [];
  let cursor = 0;
  if (/^---\r?\n/.test(source)) {
    const end = /^---[ \t]*$/gm;
    end.lastIndex = source.indexOf("\n") + 1;
    const match = end.exec(source);
    if (!match) throw new Error("UNCLOSED_YAML");
    cursor = match.index + match[0].length;
    result.push({ start: 0, end: cursor, raw: true });
  }
  const rest = source.slice(cursor);
  let fence = "";
  let depth = 0;
  for (const line of rest.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = "";
      continue;
    }
    if (fence) continue;
    if (/^\s*:{3,}/.test(line)) {
      if (/^\s*:{3,}\s*$/.test(line)) depth--;
      else depth++;
      if (depth < 0) throw new Error("DIV_BOUNDARY");
    }
  }
  if (fence || depth) throw new Error("UNCLOSED_STRUCTURE");
  const tree = parser.parse(rest);
  const nodes = tree.children;
  let divStart: number | null = null;
  let divDepth = 0;
  for (const child of nodes) {
    const start = cursor + child.position!.start.offset!;
    const end = cursor + child.position!.end.offset!;
    const text = source.slice(start, end);
    for (const line of text.split("\n")) {
      if (/^\s*:{3,}/.test(line)) {
        if (/^\s*:{3,}\s*$/.test(line)) divDepth--;
        else {
          if (divStart === null) divStart = start;
          divDepth++;
        }
      }
    }
    if (divStart !== null) {
      if (divDepth === 0) {
        result.push({ start: divStart, end, raw: true });
        divStart = null;
      }
      continue;
    }
    // Raw blocks nested in a list stay raw nodes inside the visual list.
    let probe = text;
    for (const [from, to] of nestedRawSpans(child, rest).reverse())
      probe = probe.slice(0, from - (start - cursor)) + probe.slice(to - (start - cursor));
    const raw =
      ["html", "definition", "footnoteDefinition"].includes(child.type) ||
      escapedLatex(child, rest) ||
      /(?:\{[#.=]|\{\{|\[@|(?<![\w])@[a-zA-Z][\w:-]*|\[\^|^\s*#\||```\{|~~~\{|\\(?:begin|end|input|include|newcommand)|\]\{)/m.test(
        withoutLabels(withoutFigures(probe)),
      );
    result.push({ start, end, raw });
  }
  return result;
}
export function decode(source: string, rt: CodecRuntime): Decoded {
  const segments: Segment[] = [];
  const children: PMNode[] = [];
  let end = 0;
  try {
    for (const r of ranges(source)) {
      const text = source.slice(r.start, r.end);
      let parsed: PMNode[] = [];
      const figure =
        /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)(?:\{([^}]*)\})?$/.exec(
          text,
        );
      if (figure) {
        const quarto = figureAttrs(figure[4] || "");
        if (quarto)
          parsed = [
            rt.schema.nodes["image-block"].create({
              src: figure[2],
              caption: figure[1],
              ...quarto,
            }),
          ];
      }
      if (parsed.length) {
      } else if (r.raw)
        parsed = [
          rt.schema.nodes.qollab_raw.create(
            null,
            text ? rt.schema.text(text) : undefined,
          ),
        ];
      else rt.parse(text).forEach((n) => parsed.push(n));
      if (parsed.length !== 1)
        parsed = [
          rt.schema.nodes.qollab_raw.create(
            null,
            text ? rt.schema.text(text) : undefined,
          ),
        ];
      const first = parsed[0];
      const node = first.type.create(
        { ...first.attrs, qollabId: `source-${r.start}` },
        first.content,
        first.marks,
      );
      children.push(node);
      segments.push({
        key: key(node),
        source: text,
        before: source.slice(end, r.start),
      });
      end = r.end;
    }
    const doc = rt.schema.node(
      "doc",
      null,
      children.length ? children : [rt.schema.node("paragraph")],
    );
    return {
      doc,
      safe: true,
      preservation: {
        segments,
        suffix: source.slice(end),
        original: source,
        fingerprint: key(doc),
      },
    };
  } catch (error) {
    const doc = rt.schema.node("doc", null, [
      rt.schema.nodes.qollab_raw.create(
        null,
        source ? rt.schema.text(source) : undefined,
      ),
    ]);
    return {
      doc,
      safe: false,
      reason: (error as Error).message,
      preservation: {
        segments: [],
        suffix: "",
        original: source,
        fingerprint: key(doc),
      },
    };
  }
}
export function encode(
  doc: PMNode,
  saved: Preservation,
  rt: CodecRuntime,
): string {
  doc.check();
  if (key(doc) === saved.fingerprint) return saved.original;
  const used = new Set<number>();
  const output: string[] = [];
  let rewritten = false;
  doc.forEach((node) => {
    // A figure without an uploaded image has nothing to write; `![]()` would
    // fail to parse back and break the PDF.
    if (node.type.name === "image-block" && !node.attrs.src) return;
    const match = saved.segments.findIndex(
      (s, i) => !used.has(i) && s.key === key(node),
    );
    if (match >= 0) {
      used.add(match);
      const s = saved.segments[match];
      // A rewritten block drops trailing newlines that the original segment
      // (e.g. YAML front matter) carried; keep the blocks a paragraph apart.
      const before =
        rewritten && !/\n[ \t]*\n/.test(s.before) ? "\n\n" : s.before || "\n\n";
      output.push((output.length ? before : s.before) + s.source);
      rewritten = false;
    } else {
      const rendered =
        node.type.name === "qollab_raw" ? node.textContent : render(node, rt);
      output.push((output.length ? "\n\n" : "") + rendered.trimEnd());
      rewritten = true;
    }
  });
  return output.join("") + saved.suffix;
}
function render(node: PMNode, rt: CodecRuntime): string {
  if (node.type.name === "image-block") return figureMarkdown(node.attrs);
  return rt.serialize(rt.schema.node("doc", null, [node]));
}
export function validateDocument(doc: PMNode) {
  let count = 0;
  doc.descendants((node) => {
    if (++count > 100000) throw new Error("DOCUMENT_COMPLEXITY");
    if (node.type.name === "image" || node.type.name === "image-block") {
      const src = String(node.attrs.src || "");
      if (
        /^(?:blob:|data:|javascript:|file:|\/)/i.test(src) ||
        src.includes("\\")
      )
        throw new Error("IMAGE_PATH");
    }
    if (
      node.type.name === "qollab_raw" &&
      /(?:blob:|data:image\/)/i.test(node.textContent)
    )
      throw new Error("IMAGE_PATH");
  });
}
