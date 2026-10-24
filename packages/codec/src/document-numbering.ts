import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  defaultNumbering,
  numberingSchema,
  headingCounter,
  formatNumber,
  fillPattern,
  listReference,
  type Numbering,
} from "./numbering";

export const documentBody = (source: string) =>
  source.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "");

/** Resolve counters and references once, before either HTML or Typst rendering. */
export function numberTokens(tokens: Token[], value?: Numbering) {
  const settings = numberingSchema.parse(value || defaultNumbering());
  const nextHeading = headingCounter(settings);
  const headings: ReturnType<typeof nextHeading>[] = [];
  const references: Record<string, string> = Object.create(null);
  const figures: {
    id?: string;
    label: string;
    caption: string;
    reference: string;
  }[] = [];
  const lists: { ordered: boolean; next: number }[] = [];
  let headingLabels = Array(6).fill("") as string[];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "heading_open") {
      const inline = tokens[i + 1];
      const id = /\s*\{#([\w:.-]+)\}\s*$/.exec(inline.content)?.[1];
      const title = inline.content
        .replace(/\s*\{#[\w:.-]+\}\s*$/, "")
        .replaceAll("\\textquoteright{}", "’");
      const info = nextHeading(title, Number(token.tag.slice(1)));
      headings.push(info);
      headingLabels = info.labels;
      token.meta = { ...token.meta, numbering: info };
      if (id) references[id] = info.reference;
    }
    if (token.type === "ordered_list_open" || token.type === "bullet_list_open")
      lists.push({
        ordered: token.type === "ordered_list_open",
        next: Number(token.attrGet("start") || 1),
      });
    if (token.type === "list_item_open") {
      const list = lists.at(-1)!;
      if (list.ordered && settings.lists.enabled) {
        const numbers = lists
          .filter((l) => l.ordered)
          .map((l) => (l === list ? l.next : l.next - 1));
        token.attrSet(
          "data-marker",
          formatNumber(numbers, settings.lists.levels),
        );
      } else if (!list.ordered && settings.bullets.enabled) {
        const depth = lists.filter((l) => !l.ordered).length;
        token.attrSet(
          "data-marker",
          settings.bullets.symbols[
            Math.min(depth - 1, settings.bullets.symbols.length - 1)
          ],
        );
      }
      list.next++;
    }
    if (token.type === "inline") {
      for (const match of token.content.matchAll(/\\label\{([\w:.-]+)\}/g)) {
        const numbers = lists.filter((l) => l.ordered).map((l) => l.next - 1);
        references[match[1]] =
          numbers.length && settings.lists.enabled
            ? listReference(numbers, settings, headingLabels)
            : numbers.join(".") || match[1];
      }
      const children = token.children || [];
      for (let j = 0; j < children.length; j++) {
        const image = children[j];
        if (image.type !== "image") continue;
        const attrs =
          children[j + 1]?.type === "text"
            ? /^\{([^}]*)\}/.exec(children[j + 1].content)
            : null;
        if (attrs) {
          const id = /#([\w:.-]+)/.exec(attrs[1])?.[1];
          const width =
            /width=(?:"([\d.]+(?:%|px|cm|mm))"|([\d.]+(?:%|px|cm|mm)))/.exec(
              attrs[1],
            );
          if (id) image.attrSet("id", id);
          if (width) image.attrSet("width", width[1] || width[2]);
          children[j + 1].content = children[j + 1].content.slice(
            attrs[0].length,
          );
        }
        if (
          !children.every(
            (c) => c === image || (c.type === "text" && !c.content.trim()),
          )
        )
          continue;
        const number = figures.length + 1;
        const spec = settings.figures;
        const label = spec.enabled ? formatNumber([number], [spec.label]) : "";
        const values = { label, caption: image.content };
        const caption = spec.enabled
          ? fillPattern(spec.caption, values)
          : image.content;
        const reference = spec.enabled
          ? fillPattern(
              formatNumber([number], [spec.label], {
                ...spec.label,
                style: spec.label.referenceStyle,
                format: spec.label.reference,
              }),
              values,
            )
          : image.content;
        const id = image.attrGet("id") || undefined;
        figures.push({ id, label, caption, reference });
        image.meta = { ...image.meta, figure: true, caption, label };
        if (id) references[id] = reference;
        if (tokens[i - 1]?.type === "paragraph_open")
          tokens[i - 1].hidden = true;
        if (tokens[i + 1]?.type === "paragraph_close")
          tokens[i + 1].hidden = true;
      }
    }
    if (
      token.type === "ordered_list_close" ||
      token.type === "bullet_list_close"
    )
      lists.pop();
  }
  return { settings, headings, figures, references };
}

export function numberDocument(source: string, settings?: Numbering) {
  return numberTokens(
    new MarkdownIt().parse(documentBody(source), {}),
    settings,
  );
}
