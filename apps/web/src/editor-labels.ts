import type { Node as PMNode } from "@milkdown/kit/prose/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $inputRule, $prose } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { labelKind, LABEL_ID, texKind } from "../../../packages/codec/src/labels";
import { t } from "./i18n";
import { notify } from "./ui/feedback";

export interface LabelEntry {
  id: string;
  /** fig, tbl, sec, eq… for numbered Quarto references, otherwise "span". */
  kind: string;
  /** Where the label sits: heading, span, figure, LaTeX \label or source block. */
  owner: "heading" | "span" | "figure" | "anchor" | "raw";
  text: string;
  pos: number;
  /** A LaTeX `\label{…}`: references to it are `\ref{…}`. */
  latex?: boolean;
}
export interface RefEntry {
  key: string;
  pos: number;
  link: boolean;
}
export interface LabelIndex {
  labels: LabelEntry[];
  refs: RefEntry[];
}
const rawLabel = new RegExp(
  `\\{#(${LABEL_ID})[\\s}]|#\\|\\s*label:\\s*(${LABEL_ID})|\\\\label\\{(${LABEL_ID})\\}`,
  "g",
);
const rawRef = new RegExp(
  `(?<![\\w@])@(${LABEL_ID})|\\\\(?:ref|cref|Cref|pageref|eqref|autoref|nameref)\\{(${LABEL_ID})\\}`,
  "g",
);
const snippet = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 80);

/** Every label and reference in the document, in document order. */
export function collectLabels(doc: PMNode): LabelIndex {
  const labels = new Map<string, LabelEntry>(),
    refs: RefEntry[] = [];
  const add = (entry: LabelEntry) => {
    if (!labels.has(entry.id)) labels.set(entry.id, entry);
  };
  doc.descendants((node, pos) => {
    const name = node.type.name;
    if (name === "heading" && node.attrs.label)
      add({
        id: node.attrs.label,
        kind: labelKind(node.attrs.label),
        owner: "heading",
        text: snippet(node.textContent),
        pos,
      });
    else if (name === "image-block" && node.attrs.identifier)
      add({
        id: node.attrs.identifier,
        kind: labelKind(node.attrs.identifier),
        owner: "figure",
        text: snippet(String(node.attrs.caption || node.attrs.alt || "")),
        pos,
      });
    else if (name === "qollab_ref")
      refs.push({ key: node.attrs.key, pos, link: false });
    else if (name === "qollab_tex") {
      const tex = texKind(node.attrs.source);
      if (tex.kind === "label")
        add({
          id: tex.id,
          kind: labelKind(tex.id),
          owner: "anchor",
          text: snippet(doc.resolve(pos).parent.textContent),
          pos,
          latex: true,
        });
      else if (tex.kind === "ref") refs.push({ key: tex.id, pos, link: false });
    }
    else if (name === "qollab_raw") {
      // Equations, tables and other labelled source keep working references.
      const text = node.textContent;
      if (pos === 0 && /^---\r?\n/.test(text)) return false;
      for (const m of text.matchAll(rawLabel)) {
        const id = m[1] ?? m[2] ?? m[3];
        add({ id, kind: labelKind(id), owner: "raw", text: snippet(text), pos, latex: !!m[3] });
      }
      for (const m of text.matchAll(rawRef))
        refs.push({ key: m[1] ?? m[2], pos, link: false });
      return false;
    } else if (node.isText) {
      for (const mark of node.marks) {
        if (mark.type.name === "qollab_label") {
          const existing = labels.get(mark.attrs.id);
          if (existing?.owner === "span" && existing.pos + existing.text.length >= pos)
            existing.text = snippet(existing.text + node.text);
          else
            add({
              id: mark.attrs.id,
              kind: labelKind(mark.attrs.id),
              owner: "span",
              text: snippet(node.text || ""),
              pos,
            });
        }
        if (mark.type.name === "link" && String(mark.attrs.href).startsWith("#"))
          refs.push({ key: String(mark.attrs.href).slice(1), pos, link: true });
      }
    }
    return true;
  });
  return { labels: [...labels.values()], refs };
}

// The highlight after a jump is a decoration: the editor may redraw the label's
// node right after the jump, which would drop a class set on its DOM.
const flashKey = new PluginKey<DecorationSet>("qollab-flash");
export const flashPlugin = $prose(
  () =>
    new Plugin({
      key: flashKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, old) {
          const flash = tr.getMeta(flashKey) as Decoration | null | undefined;
          if (flash === null) return DecorationSet.empty;
          if (flash) return DecorationSet.create(tr.doc, [flash]);
          return old.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations: (state) => flashKey.getState(state) },
    }),
);
/** The text a span label covers: its marked text nodes in the block. */
function spanRange(doc: PMNode, pos: number, id: string) {
  const $pos = doc.resolve(pos);
  let from = -1,
    to = -1;
  $pos.parent.forEach((child, offset) => {
    if (child.marks.some((m) => m.type.name === "qollab_label" && m.attrs.id === id)) {
      if (from < 0) from = $pos.start() + offset;
      to = $pos.start() + offset + child.nodeSize;
    }
  });
  return from < 0 ? null : { from, to };
}

/** Moves the cursor to a label, scrolls it into view and briefly highlights it. */
export function jumpTo(view: EditorView, id: string) {
  const entry = collectLabels(view.state.doc).labels.find((l) => l.id === id);
  if (!entry) return false;
  const { doc } = view.state;
  const selection =
    entry.owner === "figure" || entry.owner === "anchor"
      ? NodeSelection.create(doc, entry.pos)
      : TextSelection.near(doc.resolve(entry.owner === "span" ? entry.pos : entry.pos + 1));
  const range = entry.owner === "span" ? spanRange(doc, entry.pos, id) : null;
  const node = entry.owner === "span" ? null : doc.nodeAt(entry.pos);
  const flash = range
    ? Decoration.inline(range.from, range.to, { class: "qollab-flash" })
    : node && Decoration.node(entry.pos, entry.pos + node.nodeSize, { class: "qollab-flash" });
  view.dispatch(view.state.tr.setSelection(selection).setMeta(flashKey, flash || null));
  const dom =
    entry.owner === "span"
      ? (view.domAtPos(entry.pos + 1).node as Node).parentElement?.closest("[data-qollab-label]")
      : view.nodeDOM(entry.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => {
    if (!view.isDestroyed && flashKey.getState(view.state) !== DecorationSet.empty)
      view.dispatch(view.state.tr.setMeta(flashKey, null));
  }, 1600);
  view.focus();
  return true;
}

/** The label a reference chip points to: `@id` or a LaTeX `\ref{id}`. */
export function referenceKey(node: PMNode) {
  if (node.type.name === "qollab_ref") return String(node.attrs.key);
  if (node.type.name === "qollab_tex") {
    const tex = texKind(node.attrs.source);
    if (tex.kind === "ref") return tex.id;
  }
  return null;
}
/** Puts a label's name on the clipboard, e.g. to write a reference elsewhere. */
export function copyLabel(id: string) {
  navigator.clipboard.writeText(id).then(
    () => notify(t("labelCopied") + id),
    () => notify(t("copyFailed"), "error"),
  );
}
/** The `#` after a labelled span or heading: the tooltip names it, a click copies it. */
function labelTag(id: string, heading: boolean) {
  return () => {
    const tag = document.createElement("span");
    tag.className = heading ? "qollab-label-tag heading" : "qollab-label-tag";
    tag.textContent = "#";
    tag.dataset.tip = "#" + id;
    tag.dataset.tipDelay = "0";
    tag.addEventListener("click", () => copyLabel(id));
    return tag;
  };
}
const tagAt = (pos: number, id: string, heading = false) =>
  Decoration.widget(pos, labelTag(id, heading), {
    side: heading ? 1 : -1,
    marks: [],
    key: (heading ? "heading:" : "label:") + id,
    // The editor leaves clicks on the tag to its own handler.
    stopEvent: () => true,
  });
/** Marks references whose label is missing and shows each target's text. */
const key = new PluginKey<DecorationSet>("qollabRefs");
function decorate(doc: PMNode) {
  const index = collectLabels(doc),
    known = new Map(index.labels.map((l) => [l.id, l]));
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.attrs.label)
      decorations.push(tagAt(pos + node.nodeSize - 1, node.attrs.label, true));
    if (node.isTextblock) {
      let open: string | null = null;
      node.forEach((child, offset) => {
        const id = child.marks.find((m) => m.type.name === "qollab_label")?.attrs.id ?? null;
        if (open && open !== id) decorations.push(tagAt(pos + 1 + offset, open));
        open = id;
      });
      if (open) decorations.push(tagAt(pos + node.nodeSize - 1, open));
    }
    const ref = referenceKey(node);
    if (ref === null) return true;
    const target = known.get(ref);
    // A LaTeX \ref always expects a label; @key may also be a citation.
    const numbered = node.type.name === "qollab_tex" || labelKind(ref) !== "span";
    const written = node.type.name === "qollab_tex" ? node.attrs.source : `@${ref}`;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: target ? "qollab-ref-ok" : numbered ? "qollab-ref-broken" : "qollab-ref-cite",
        ...(node.type.name === "qollab_tex"
          ? {}
          : {
              "data-tip": target ? `${written} → ${target.text || target.id}` : written,
              "data-tip-delay": "0",
            }),
      }),
    );
    return false;
  });
  return DecorationSet.create(doc, decorations);
}
export const referencePlugin = $prose(
  () =>
    new Plugin({
      key,
      state: {
        init: (_, state) => decorate(state.doc),
        apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
      },
      props: {
        decorations: (state) => key.getState(state),
        // Clicking a reference jumps to its label; Ctrl/⌘-click follows #links.
        handleClickOn(view, _pos, node, _nodePos, event) {
          const ref = referenceKey(node);
          if (ref !== null) return jumpTo(view, ref);
          // A LaTeX \label chip copies its name and stays selected.
          const tex = node.type.name === "qollab_tex" ? texKind(node.attrs.source) : null;
          if (tex?.kind === "label") copyLabel(tex.id);
          if (!(event.metaKey || event.ctrlKey)) return false;
          const anchor = (event.target as HTMLElement).closest?.("a[href^='#']");
          return anchor ? jumpTo(view, anchor.getAttribute("href")!.slice(1)) : false;
        },
      },
    }),
);
/** Typing `\ref{id}` (or `\label{id}`, `\cref{id}`…) turns it into a chip at the closing brace. */
export const texReferenceRule = $inputRule(
  () =>
    new InputRule(
      new RegExp(`\\\\(?:label|ref|cref|Cref|pageref|eqref|autoref|nameref)\\{${LABEL_ID}\\}$`),
      (state, match, start, end) =>
        state.tr.replaceWith(start, end, state.schema.nodes.qollab_tex.create({ source: match[0] })),
    ),
);
