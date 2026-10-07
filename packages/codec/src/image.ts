/** Width shared by the visual view and Quarto. Ratio is legacy Crepe state. */
export function imageWidth(attrs: Record<string, unknown>): string {
  const width = String(attrs.width || "").trim();
  const ratio = Number(attrs.ratio ?? 1);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) return width;
  const match = /^(\d+(?:\.\d+)?)(%|px|pt|in|cm|mm)?$/.exec(width || "100%");
  if (!match) return width;
  return `${Math.round(Number(match[1]) * ratio * 100) / 100}${match[2] || "px"}`;
}
