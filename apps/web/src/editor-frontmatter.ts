import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, TextSelection, type Transaction } from "@milkdown/kit/prose/state";
import { $prose, $view } from "@milkdown/kit/utils";
import { ySyncPluginKey } from "y-prosemirror";
import { rawNode } from "../../../packages/codec/src/schema";

// The YAML front matter is edited in the document settings panel. In the text
// it stays hidden, unreachable by the cursor and safe from accidental edits.
export const frontMatterMeta = "qollabFrontMatter";
const isFront = (node: PMNode | null | undefined) =>
  node?.type.name === "qollab_raw" && /^---\r?\n/.test(node.textContent);

export const rawView = $view(rawNode, () => (initial, _view, getPos) => {
  let node = initial;
  const hidden = getPos() === 0 && isFront(node);
  if (hidden) {
    const dom = document.createElement("div");
    dom.className = "qollab-frontmatter";
    dom.hidden = true;
    return {
      dom,
      update: (next) => {
        if (next.type !== node.type || !isFront(next)) return false;
        node = next;
        return true;
      },
      ignoreMutation: () => true,
      stopEvent: () => true,
    };
  }
  const dom = document.createElement("pre");
  dom.className = "qollab-raw";
  dom.dataset.qollabRaw = "true";
  dom.spellcheck = false;
  const code = document.createElement("code");
  dom.append(code);
  return {
    dom,
    contentDOM: code,
    update: (next) => {
      if (next.type !== node.type || (getPos() === 0 && isFront(next))) return false;
      node = next;
      return true;
    },
  };
});

const allowed = (tr: Transaction) =>
  !!tr.getMeta(frontMatterMeta) || !!tr.getMeta(ySyncPluginKey)?.isChangeOrigin;
const afterFront = (doc: PMNode) =>
  isFront(doc.firstChild) ? doc.firstChild!.nodeSize : 0;

export const frontMatterGuard = $prose(
  () =>
    new Plugin({
      // Local edits may not change, remove or push down the front matter.
      filterTransaction(tr) {
        if (!tr.docChanged || allowed(tr)) return true;
        const before = tr.before.firstChild;
        if (!isFront(before)) return true;
        return !!tr.doc.firstChild && tr.doc.firstChild.eq(before!);
      },
      // Keep the cursor below it (e.g. after Ctrl+Home or arrow keys).
      appendTransaction(_trs, _old, state) {
        const target = below(state.doc, state.selection.from);
        return target ? state.tr.setSelection(target) : null;
      },
    }),
);
/** A text position below the front matter when `from` is inside it. */
function below(doc: PMNode, from: number) {
  const end = afterFront(doc);
  if (!end || from >= end || end >= doc.content.size) return null;
  const target = TextSelection.near(doc.resolve(end), 1);
  return target.from >= end ? target : null;
}
/** Initial selection sits inside the front matter; move it before any input. */
export function leaveFrontMatter(view: import("@milkdown/kit/prose/view").EditorView) {
  const target = below(view.state.doc, view.state.selection.from);
  if (target) view.dispatch(view.state.tr.setSelection(target));
}
