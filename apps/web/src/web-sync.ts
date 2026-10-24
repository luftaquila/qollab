import { normalize, type SyncAnchor } from "./editor-sync";

/** Locate text, then its character, rather than equating two scroll percentages. */
export function followWeb(container: HTMLElement, anchor: SyncAnchor) {
  const run = anchor.runs[anchor.run];
  if (!run) return;
  const blocks = [
    ...container.querySelectorAll<HTMLElement>(
      "h1,h2,h3,h4,h5,h6,p,li,td,th,pre,figcaption",
    ),
  ];
  let best: { element: HTMLElement; index: number; score: number } | undefined;
  blocks.forEach((element, i) => {
    const text = normalize(element.textContent || "");
    const index = text.indexOf(run);
    if (index < 0) return;
    let score =
      (text === run ? 4 : 0) -
      Math.abs(i / Math.max(blocks.length - 1, 1) - anchor.order);
    for (const [offset, neighbors] of [
      [-1, anchor.before],
      [1, anchor.after],
    ] as const) {
      const neighbor = normalize(blocks[i + offset]?.textContent || "");
      if (neighbors.some((n) => n && neighbor.includes(n))) score += 2;
    }
    if (!best || score > best.score) best = { element, index, score };
  });
  if (!best) return;
  const target = best as { element: HTMLElement; index: number };
  let remaining = target.index + anchor.offset;
  const walker = document.createTreeWalker(
    target.element,
    NodeFilter.SHOW_TEXT,
  );
  let rect = target.element.getBoundingClientRect();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || "";
    let offset = 0;
    for (const char of text) {
      const size = normalize(char).length;
      if (size && remaining <= size) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + char.length);
        rect = range.getBoundingClientRect();
        remaining = -1;
        break;
      }
      remaining -= size;
      offset += char.length;
    }
    if (remaining < 0) break;
  }
  container.scrollTop +=
    rect.top -
    container.getBoundingClientRect().top -
    container.clientHeight * Math.max(0.05, Math.min(0.9, anchor.ratio));
}
