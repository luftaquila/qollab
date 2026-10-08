import { headingSchema } from "@milkdown/kit/preset/commonmark";
import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  escapeLatex,
  headingLabel,
  inlineLabels,
  latexFormats,
  texKind,
  unescapeLatex,
} from "./labels.js";
import { figureAttrs, figureMarkdown } from "./image.js";
import { rawFence } from "./raw.js";
import { cssColor } from "./typesetting.js";
import { $node, $mark, $remark } from "@milkdown/kit/utils";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
export const rawNode = $node("qollab_raw", () => ({
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,
  parseDOM: [{ tag: "pre[data-qollab-raw]" }],
  toDOM: () => [
    "pre",
    { "data-qollab-raw": "true", class: "qollab-raw", spellcheck: "false" },
    ["code", 0],
  ],
  // Top-level raw blocks come from the codec; raw blocks in lists from labelSyntax.
  parseMarkdown: {
    match: (node) => node.type === "qollabRawBlock",
    runner: (state, node, type) => {
      state.openNode(type);
      if (node.value) state.addText(node.value as string);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (n) => n.type.name === "qollab_raw",
    runner: (state, node) => {
      state.addNode("qollabVerbatim", undefined, node.textContent);
    },
  },
}));
export const imageAttributes = imageBlockSchema.extendSchema(
  (prev) => (ctx) => {
    const schema = prev(ctx);
    return {
      ...schema,
      attrs: {
        ...schema.attrs,
        alt: { default: "" },
        width: { default: "" },
        align: { default: "" },
        identifier: { default: "" },
      },
      // Figures inside lists come from the labels transform with Quarto
      // attributes; top-level figures are decoded by the codec itself.
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          const quarto = (node as any).qollabFigure;
          if (!quarto) return schema.parseMarkdown.runner(state, node, type);
          state.addNode(type, { src: node.url, caption: node.title ?? "", ratio: 1, ...quarto });
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          state.openNode("paragraph");
          state.addNode("html", undefined, figureMarkdown(node.attrs));
          state.closeNode();
        },
      },
    };
  },
);

import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { createTimer } from "@milkdown/kit/ctx";
import { nodesCtx, schemaTimerCtx, InitReady } from "@milkdown/kit/core";
const SourceIdsReady = createTimer("QollabSourceIdsReady");
// IDs are part of both schemas and therefore survive Yjs updates. Identical
// paragraphs with different original spelling never borrow each other's source.
export const sourceIds: MilkdownPlugin = (ctx) => {
  ctx.record(SourceIdsReady);
  ctx.update(schemaTimerCtx, (timers) => [...timers, SourceIdsReady]);
  return async () => {
    await ctx.wait(InitReady);
    ctx.update(nodesCtx, (nodes) =>
      nodes.map(([name, spec]) => [
        name,
        spec.group?.split(" ").includes("block")
          ? {
              ...spec,
              attrs: {
                ...spec.attrs,
                qollabId: { default: null, validate: "string|null" },
              },
            }
          : spec,
      ]),
    );
    ctx.done(SourceIdsReady);
    return () => {
      ctx.clearTimer(SourceIdsReady);
    };
  };
};

// --- Labels and cross-references -------------------------------------------

/** `@id` / `[@id]`, kept exactly as written. */
export const refNode = $node("qollab_ref", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    key: { default: "", validate: "string" },
    bracketed: { default: true, validate: "boolean" },
  },
  parseDOM: [
    {
      tag: "span[data-qollab-ref]",
      getAttrs: (dom) => ({
        key: (dom as HTMLElement).dataset.qollabRef,
        bracketed: (dom as HTMLElement).dataset.bracketed !== "false",
      }),
    },
  ],
  toDOM: (node) => [
    "span",
    {
      "data-qollab-ref": node.attrs.key,
      "data-bracketed": String(node.attrs.bracketed),
      class: "qollab-ref",
    },
    "@" + node.attrs.key,
  ],
  parseMarkdown: {
    match: (node) => node.type === "qollabRef",
    runner: (state, node, type) => {
      state.addNode(type, { key: node.key, bracketed: !!node.bracketed });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "qollab_ref",
    runner: (state, node) => {
      const key = node.attrs.key;
      state.addNode("qollabVerbatim", undefined, node.attrs.bracketed ? `[@${key}]` : `@${key}`);
    },
  },
}));
/** A LaTeX command in text (`\\ref{id}`, `\\label{id}`, `\\newpage`), kept as written. */
export const texNode = $node("qollab_tex", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { source: { default: "", validate: "string" } },
  parseDOM: [
    {
      tag: "span[data-qollab-tex]",
      getAttrs: (dom) => ({ source: (dom as HTMLElement).dataset.qollabTex }),
    },
  ],
  toDOM: (node) => {
    const source = String(node.attrs.source);
    const { kind, id } = texKind(source);
    return [
      "span",
      {
        "data-qollab-tex": source,
        "data-kind": kind,
        class: "qollab-tex",
        // The app's tooltip (not the browser's title) names a label at once;
        // the editor copies the name on click.
        "data-tip": kind === "label" ? "#" + id : null,
        "data-tip-delay": kind === "label" ? "0" : null,
        contenteditable: "false",
      },
      // A label in running text shows only its mark (CSS); the tooltip names it.
      kind === "command" || kind === "math" ? source : kind === "label" ? "" : id,
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === "qollabTex",
    runner: (state, node, type) => {
      state.addNode(type, { source: node.value });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "qollab_tex",
    runner: (state, node) => {
      state.addNode("qollabVerbatim", undefined, node.attrs.source);
    },
  },
}));
/** `[text]{#id}`: a labelled span whose text stays editable. */
export const labelMark = $mark("qollab_label", () => ({
  attrs: { id: { default: "", validate: "string" } },
  inclusive: false,
  parseDOM: [
    {
      tag: "span[data-qollab-label]",
      getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.qollabLabel }),
    },
  ],
  toDOM: (mark) => [
    "span",
    { "data-qollab-label": mark.attrs.id, class: "qollab-label" },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "qollabLabel",
    runner: (state, node, markType) => {
      state.openMark(markType, { id: node.id });
      state.next(node.children as any);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "qollab_label",
    runner: (state, mark) => {
      state.withMark(mark, "qollabLabel", undefined, { id: mark.attrs.id });
    },
  },
}));
/** `# Title {#sec-id}` keeps its label as a heading attribute. */
export const headingLabels = headingSchema.extendSchema(
  (prev) => (ctx) => {
    const schema = prev(ctx);
    return {
      ...schema,
      attrs: { ...schema.attrs, label: { default: "", validate: "string" } },
      toDOM: (node) => {
        const dom = [...(schema.toDOM!(node) as unknown as any[])];
        if (node.attrs.label) dom[1] = { ...dom[1], "data-label": node.attrs.label };
        return dom as any;
      },
      parseMarkdown: {
        match: schema.parseMarkdown.match,
        runner: (state, node, type) => {
          state.openNode(type, {
            level: node.depth as number,
            label: (node.qollabLabel as string) || "",
          });
          state.next(node.children);
          state.closeNode();
        },
      },
      toMarkdown: {
        match: schema.toMarkdown.match,
        runner: (state, node) => {
          state.openNode("heading", undefined, { depth: node.attrs.level });
          let content = node.content;
          if (node.lastChild?.type.name === "hardbreak")
            content = content.cut(0, content.size - node.lastChild.nodeSize);
          state.next(content);
          if (node.attrs.label)
            state.addNode("html", undefined, ` {#${node.attrs.label}}`);
          state.closeNode();
        },
      },
    };
  },
);
// Parsing: turn the supported label syntax into mdast nodes the schema reads.
function splitText(value: string) {
  const out: any[] = [];
  let last = 0;
  for (const m of value.matchAll(inlineLabels())) {
    if (m.index! > last) out.push({ type: "text", value: value.slice(last, m.index) });
    if (m[2] !== undefined)
      out.push({ type: "qollabLabel", id: m[2], children: [{ type: "text", value: m[1] }] });
    else if (m[3] !== undefined)
      out.push({ type: "qollabUnderline", children: [{ type: "text", value: m[3] }] });
    else if (m[6] !== undefined)
      out.push({
        type: "qollabColor",
        color: m[4] ? "#" + m[4].toUpperCase() : m[5],
        // \color ignores spaces after it, so a leading space is not text.
        children: latexChildren(m[6].replace(/^\s+/, "")),
      });
    else if (m[7] !== undefined || m[8] !== undefined)
      out.push({ type: "qollabRef", key: m[7] ?? m[8], bracketed: m[7] !== undefined });
    else out.push({ type: "qollabTex", value: m[0] });
    last = m.index! + m[0].length;
  }
  if (!out.length) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}
// The inverse of `latex()` for the formatting the editor writes inside \textcolor.
function latexChildren(value: string) {
  const out: any[] = [];
  let last = 0;
  const text = (raw: string) => raw && out.push({ type: "text", value: unescapeLatex(raw) });
  for (const m of value.matchAll(latexFormats())) {
    text(value.slice(last, m.index));
    const inner = unescapeLatex(m[2] ?? "");
    if (m[3]) out.push({ type: "qollabTex", value: m[3] });
    else if (m[1] === "texttt") out.push({ type: "inlineCode", value: inner });
    else if (inner)
      out.push({
        type: m[1] === "ul" ? "qollabUnderline" : m[1] === "textbf" ? "strong" : "emphasis",
        children: [{ type: "text", value: inner }],
      });
    last = m.index! + m[0].length;
  }
  text(value.slice(last));
  return out;
}
const opaque = ["code", "inlineCode", "html", "math", "inlineMath", "link", "linkReference"];
// `![caption](src){#fig-… width=…}` alone in a paragraph inside a list: the
// same figure the codec decodes at the top level.
function figure(paragraph: any) {
  const [image, attrs] = paragraph.children || [];
  if (paragraph.children?.length !== 2 || image.type !== "image" || attrs.type !== "text")
    return null;
  const m = /^\{([^{}\n]*)\}$/.exec(attrs.value);
  const quarto = m && figureAttrs(m[1]);
  if (!quarto) return null;
  return { type: "image-block", url: image.url, title: image.alt ?? "", qollabFigure: quarto };
}
function transform(node: any, source = "") {
  if (!node.children) return;
  if (node.type === "listItem")
    node.children = node.children.map((child: any) =>
      child.type === "paragraph" ? (figure(child) ?? child) : child,
    );
  if (node.type === "heading") {
    const tail = node.children[node.children.length - 1];
    const match = tail?.type === "text" ? headingLabel.exec(tail.value) : null;
    if (match) {
      tail.value = tail.value.slice(0, match.index);
      if (!tail.value) node.children.pop();
      node.qollabLabel = match[1];
    }
  }
  node.children = node.children.flatMap((child: any) => {
    if (child.type === "text") return splitText(child.value) ?? [child];
    // `$$…$$` inside a paragraph is display math in Quarto; the inline math
    // node would write it back with single dollars.
    if (child.type === "inlineMath" && child.position) {
      const written = source.slice(child.position.start.offset, child.position.end.offset);
      if (written.startsWith("$$")) return [{ type: "qollabTex", value: written }];
    }
    const fence = rawFence(source, child);
    if (fence !== null) return [{ type: "qollabRawBlock", value: fence }];
    if (!opaque.includes(child.type)) transform(child, source);
    return [child];
  });
}
export const labelSyntax = $remark(
  "qollabLabels",
  () => () => (tree: any, file: any) => transform(tree, String(file?.value ?? "")),
);
/** `[text]{.underline}` */
export const underlineMark = $mark("qollab_underline", () => ({
  parseDOM: [{ tag: "u" }],
  toDOM: () => ["u", 0],
  parseMarkdown: {
    match: (node) => node.type === "qollabUnderline",
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children as any);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "qollab_underline",
    runner: (state, mark) => {
      state.withMark(mark, "qollabUnderline");
    },
  },
}));
/** LaTeX color names (xcolor) or #RRGGBB, written as `\textcolor`. */
export const colorMark = $mark("qollab_color", () => ({
  attrs: { color: { default: "red", validate: "string" } },
  parseDOM: [
    {
      tag: "span[data-qollab-color]",
      getAttrs: (dom) => ({ color: (dom as HTMLElement).dataset.qollabColor }),
    },
  ],
  toDOM: (mark) => [
    "span",
    {
      "data-qollab-color": mark.attrs.color,
      class: "qollab-color",
      // The editor theme reads the variable, so dark mode can lighten it.
      style: `--qollab-color: ${cssColor(mark.attrs.color)}`,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === "qollabColor",
    runner: (state, node, markType) => {
      state.openMark(markType, { color: node.color });
      state.next(node.children as any);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "qollab_color",
    runner: (state, mark) => {
      state.withMark(mark, "qollabColor", undefined, { color: mark.attrs.color });
    },
  },
}));
// Inside \textcolor{…}{…} LaTeX reads the text, so nested Markdown becomes LaTeX.
function latex(node: any): string {
  const inner = () => (node.children || []).map(latex).join("");
  switch (node.type) {
    case "text":
      return escapeLatex(node.value);
    case "strong":
      return `\\textbf{${inner()}}`;
    case "emphasis":
      return `\\textit{${inner()}}`;
    case "inlineCode":
      return `\\texttt{${escapeLatex(node.value)}}`;
    case "qollabUnderline":
      return `\\ul{${inner()}}`;
    case "html":
    case "qollabVerbatim":
      return node.value;
    case "break":
      return "\\\\";
    default:
      return inner();
  }
}
const colorCommand = (color: string) =>
  /^#[0-9A-Fa-f]{6}$/.test(color)
    ? `\\textcolor[HTML]{${color.slice(1).toUpperCase()}}`
    : `\\textcolor{${color.replace(/[^A-Za-z]/g, "") || "black"}}`;
/** Serializes labelled spans; refs and heading labels are written verbatim. */
export function configureLabels(ctx: Ctx) {
  ctx.update(remarkStringifyOptionsCtx, (prev: any) => ({
    ...prev,
    handlers: {
      ...prev.handlers,
      qollabLabel: (node: any, _parent: any, state: any, info: any) => {
        const exit = state.enter("label");
        const tracker = state.createTracker(info);
        let value = tracker.move("[");
        value += tracker.move(
          state.containerPhrasing(node, {
            before: value,
            after: "]",
            ...tracker.current(),
          }),
        );
        value += tracker.move("]{#" + node.id + "}");
        exit();
        return value;
      },
      qollabUnderline: (node: any, _parent: any, state: any, info: any) => {
        const exit = state.enter("label");
        const tracker = state.createTracker(info);
        let value = tracker.move("[");
        value += tracker.move(
          state.containerPhrasing(node, {
            before: value,
            after: "]",
            ...tracker.current(),
          }),
        );
        value += tracker.move("]{.underline}");
        exit();
        return value;
      },
      // Written as is. Not an "html" node: before inline HTML the serializer
      // turns a line break into a space, which would drop a hard break.
      qollabVerbatim: (node: any) => node.value,
      qollabColor: (node: any) =>
        `${colorCommand(node.color)}{${(node.children || []).map(latex).join("")}}`,
    },
  }));
}
// Mark order decides nesting when written out: a color wraps underlined text
// (`\textcolor{red}{\ul{…}}`), since Quarto's underline span cannot hold LaTeX.
export const labelPlugins = [
  refNode,
  texNode,
  labelMark,
  colorMark,
  underlineMark,
  headingLabels,
  labelSyntax,
].flat();
