import { normalize, worded, type SyncAnchor } from "./editor-sync";

const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,td,th,pre,figcaption";
/**
 * The text nodes of a block itself. Blocks nest (a paragraph in a list item,
 * an item's own line above its sub-list): text inside a nested block belongs
 * to that block only, so each text is found once and neighbors are real ones.
 */
function ownText(element: HTMLElement) {
  return document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    (node) =>
      node.nodeType === Node.TEXT_NODE
        ? NodeFilter.FILTER_ACCEPT
        : (node as Element).matches(BLOCKS)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP,
  );
}
// Normalized once per element: the preview replaces its elements when the
// document changes, and comparing a long document again on every scrolled
// frame would hold the scroll back.
const texts = new WeakMap<HTMLElement, string>();
function textOf(element: HTMLElement | undefined) {
  if (!element) return "";
  let text = texts.get(element);
  if (text === undefined) {
    text = "";
    const walker = ownText(element);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      text += normalize(node.textContent || "");
    texts.set(element, text);
  }
  return text;
}
/** How much of some runs is found, in order, in a text. */
function found(runs: string[], text: string) {
  let length = 0,
    from = 0;
  for (const run of runs) {
    const at = run ? text.indexOf(run, from) : -1;
    if (at < 0) continue;
    length += run.length;
    from = at + run.length;
  }
  return length;
}
/** The top in the viewport of the character at a place in a block's text. */
function charTop(element: HTMLElement, place: number) {
  const walker = ownText(element);
  let remaining = place;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let offset = 0;
    for (const char of node.textContent || "") {
      const size = normalize(char).length;
      if (size && remaining <= size) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + char.length);
        return range.getBoundingClientRect().top;
      }
      remaining -= size;
      offset += char.length;
    }
  }
  return element.getBoundingClientRect().top;
}
/**
 * The top of an anchor's character in the viewport: its text, then the
 * character. `expected` is the height the editor shows it at, which is where
 * the preview has it already when the two are in step.
 */
function locate(blocks: HTMLElement[], anchor: SyncAnchor, expected: number) {
  const run = anchor.runs[anchor.run];
  if (!run || !worded(run)) return undefined;
  const total = anchor.runs.reduce((sum, part) => sum + part.length, 0),
    earlier = anchor.runs.slice(0, anchor.run),
    later = anchor.runs.slice(anchor.run + 1),
    context = anchor.before.length + anchor.after.length;
  // The places with the most evidence of being the anchor's.
  let places: { element: HTMLElement; block: number; index: number }[] = [],
    most = 0;
  blocks.forEach((element, block) => {
    if (anchor.heading && !/^H[1-6]$/.test(element.tagName)) return;
    const text = textOf(element);
    // A sentence may recur in every clause, and being the whole of a block
    // proves little for a short text: what tells the places apart is how
    // many of the texts around the anchor are found around them, in the
    // nearest blocks or, when the anchor is one line of a longer block (a
    // wrapped paragraph, a raw block), in the rest of this one.
    const near = (texts: string[], side: number, own: string) =>
      texts.filter(
        (n) =>
          n &&
          (own.includes(n) ||
            [1, 2, 3, 4].some((d) =>
              textOf(blocks[block + side * d]).includes(n),
            )),
      ).length;
    // The same words open many clauses and recur within a long block (the
    // rows of a raw table), so every place they are found is weighed.
    for (
      let index = text.indexOf(run), tried = 0;
      index >= 0 && tried < 16;
      index = text.indexOf(run, index + 1), tried++
    ) {
      const head = text.slice(0, index),
        tail = text.slice(index + run.length),
        // The block's other runs around the place: chips and formulas
        // between them print as something else.
        matched = run.length + found(earlier, head) + found(later, tail);
      let evidence =
        (matched === text.length ? Math.min(4, matched / 4) : 0) +
        (4 * matched) / total;
      if (evidence + context < most - 1e-9) continue;
      evidence += near(anchor.before, -1, head) + near(anchor.after, 1, tail);
      if (evidence < most - 1e-9) continue;
      if (evidence > most + 1e-9) places = [];
      most = Math.max(most, evidence);
      places.push({ element, block, index });
    }
  });
  if (!places.length) return undefined;
  // The evidence being equal, the place in the document decides.
  const away = (place: { block: number }) =>
      Math.abs(place.block / Math.max(blocks.length - 1, 1) - anchor.order),
    nearest = places.reduce((a, b) => (away(b) < away(a) ? b : a));
  // It cannot tell places a few blocks apart (rows of a table that repeat
  // with all that is around them): of those the one nearest to where the
  // anchor is expected wins, since scrolling moves in small steps.
  let top: number | undefined;
  for (const place of places) {
    if (Math.abs(place.block - nearest.block) > 8) continue;
    const at = charTop(place.element, place.index + anchor.offset);
    if (top === undefined || Math.abs(at - expected) < Math.abs(top - expected))
      top = at;
  }
  return top;
}
/**
 * Shows the anchor at the height it has in the editor. A scrolling anchor
 * names the blocks around a line of the editor: the preview shows the place
 * as far between the nearest two as the line is, so it moves evenly with the
 * editor however differently the two lay the text out.
 */
export function followWeb(container: HTMLElement, anchor: SyncAnchor) {
  const blocks = [...container.querySelectorAll<HTMLElement>(BLOCKS)].filter(
    textOf,
  );
  const line = anchor.line ?? anchor.ratio,
    height = container.clientHeight,
    edge = container.getBoundingClientRect().top;
  // The nearest located block at or above the line and the nearest below it.
  let above: { ratio: number; top: number } | undefined,
    below: { ratio: number; top: number } | undefined;
  for (const point of [anchor, ...(anchor.around ?? [])]) {
    const top = locate(blocks, point, edge + height * point.ratio);
    if (top === undefined) continue;
    if (point.ratio <= line) {
      if (!above || point.ratio > above.ratio)
        above = { ratio: point.ratio, top };
    } else if (!below || point.ratio < below.ratio)
      below = { ratio: point.ratio, top };
  }
  let top: number;
  if (above && below && below.top >= above.top)
    top =
      above.top +
      ((below.top - above.top) * (line - above.ratio)) /
        (below.ratio - above.ratio);
  else if (above) top = above.top + (line - above.ratio) * height;
  else if (below) top = below.top - (below.ratio - line) * height;
  else return;
  container.scrollTop += top - edge - height * line;
}
