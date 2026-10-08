/** Width shared by the visual view and Quarto. Ratio is legacy Crepe state. */
export function imageWidth(attrs: Record<string, unknown>): string {
  const width = String(attrs.width || "").trim();
  const ratio = Number(attrs.ratio ?? 1);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return width;
  const match = /^(\d+(?:\.\d+)?)(%|px|pt|in|cm|mm)?$/.exec(width || "100%");
  if (!match) return width;
  return `${Math.round(Number(match[1]) * ratio * 100) / 100}${match[2] || "px"}`;
}
/** `![caption](src){#id fig-alt="…" width="…" fig-align="…"}` */
export function figureMarkdown(a: Record<string, any>) {
  const safe = (s: unknown) =>
    String(s || "")
      .replaceAll('"', '\\"')
      .replaceAll("\n", " ");
  let attrs = "";
  if (a.identifier) attrs += ` #${safe(a.identifier)}`;
  if (a.alt) attrs += ` fig-alt="${safe(a.alt)}"`;
  const width = imageWidth(a);
  if (width) attrs += ` width="${safe(width)}"`;
  if (a.align) attrs += ` fig-align="${safe(a.align)}"`;
  return `![${String(a.caption || "").replaceAll("]", "\\]")}](${a.src})${attrs ? "{" + attrs.trim() + "}" : ""}`;
}
/** Quarto figure attributes the visual figure edits; anything else stays source. */
export const FIGURE_ATTRS = /#[\w-]+|(?:fig-alt|width|fig-align)=(?:"[^"]*"|'[^']*'|[^\s}]+)/g;
export function figureAttrs(attrs: string) {
  if (attrs.replace(FIGURE_ATTRS, "").trim()) return null;
  const prop = (name: string) =>
    new RegExp(name + "=(?:\"([^\"]*)\"|'([^']*)'|([^\\s}]+))")
      .exec(attrs)
      ?.slice(1)
      .find((v) => v !== undefined) || "";
  return {
    alt: prop("fig-alt"),
    width: prop("width"),
    align: prop("fig-align"),
    identifier: /#([\w-]+)/.exec(attrs)?.[1] || "",
  };
}
