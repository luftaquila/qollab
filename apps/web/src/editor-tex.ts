import katex from "katex";
import { DOMSerializer } from "@milkdown/kit/prose/model";
import { $view } from "@milkdown/kit/utils";
import { texNode } from "../../../packages/codec/src/schema";
import { texKind } from "../../../packages/codec/src/labels";

// KaTeX sets letters in a formula one by one; Hangul words read as text, as
// the PDF sets them in the body font.
const HANGUL = "[\\u1100-\\u11ff\\u3130-\\u318f\\uac00-\\ud7af]+";
const hangulWords = new RegExp(`${HANGUL}(?:(?:\\\\ |\\s)+${HANGUL})*`, "g");
const forDisplay = (tex: string) =>
  tex.replace(hangulWords, (words) => `\\text{${words.replace(/\\ /g, " ")}}`);

/**
 * `$$…$$` kept in a paragraph is display math in the PDF: show it typeset and
 * centred instead of as source, shrunk to fit the column when it is wider.
 * Other LaTeX chips render as the schema says.
 */
export const texView = $view(texNode, () => (initial) => {
  const source = String(initial.attrs.source);
  if (texKind(source).kind !== "math") {
    const dom = DOMSerializer.renderSpec(document, initial.type.spec.toDOM!(initial)).dom as HTMLElement;
    return {
      dom,
      update: (next) => next.type === initial.type && next.attrs.source === source,
      ignoreMutation: () => true,
    };
  }
  const dom = document.createElement("span");
  dom.className = "qollab-tex";
  dom.dataset.qollabTex = source;
  dom.dataset.kind = "math";
  dom.contentEditable = "false";
  // Hangul and other text inside math also renders in the Typst PDF.
  katex.render(forDisplay(source.slice(2, -2)), dom, {
    displayMode: true,
    throwOnError: false,
    strict: "ignore",
    trust: false,
  });
  // Measured at full size, once the formula is in the page and whenever the
  // column width changes (the formula's own height change does not count).
  let width = -1;
  const fit = () => {
    const column = dom.clientWidth;
    if (!dom.isConnected || !column || column === width) return;
    width = column;
    // Centred overflow hangs out on both sides, beyond scrollWidth; a range
    // over the formula measures all of it.
    dom.style.fontSize = "";
    const range = document.createRange();
    range.selectNodeContents(dom.querySelector(".katex-html") ?? dom);
    const natural = range.getBoundingClientRect().width;
    dom.style.fontSize = natural > column ? `${Math.max(0.5, column / natural)}em` : "";
  };
  // KaTeX's fonts arrive after the first layout and widen the formula.
  const refit = () => {
    width = -1;
    fit();
  };
  const resize = new ResizeObserver(fit);
  resize.observe(dom);
  requestAnimationFrame(fit);
  document.fonts.addEventListener("loadingdone", refit);
  void document.fonts.ready.then(refit);
  return {
    dom,
    update: (next) => next.type === initial.type && next.attrs.source === source,
    ignoreMutation: () => true,
    destroy: () => {
      resize.disconnect();
      document.fonts.removeEventListener("loadingdone", refit);
    },
  };
});
