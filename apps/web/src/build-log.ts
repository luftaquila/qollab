import { t, fmt } from "./i18n";
// Quarto/XeLaTeX logs run to hundreds of lines of warnings. Pull out the
// line that explains a failure so people do not have to read the whole log.
const known: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/Unsupported render option: (\S+)/, (m) => fmt("errOption", { name: m[1] })],
  [/Font is not installed/, () => t("errFontPolicy")],
  [/Executable cells and shortcodes are disabled/, () => t("errExecutable")],
  [/Remote images are disabled/, () => t("errRemoteImage")],
  [/RENDER_TIMEOUT/, () => t("errTimeout")],
  [/The font "([^"]+)" cannot be found/, (m) => fmt("errFont", { name: m[1] })],
  [/LaTeX Error: File `([^']+)' not found/, (m) => fmt("errFile", { name: m[1] })],
  [/^! Undefined control sequence\.[\s\S]*?^l\.\d+ .*?(\\[A-Za-z@]+)\s*$/m, (m) => fmt("errCommand", { name: m[1] })],
  [/^! Missing \$ inserted/m, () => t("errMath")],
];
export function summarizeLog(log?: string) {
  if (!log) return "";
  const clean = log.replace(/\x1b\[[0-9;]*m/g, "");
  for (const [pattern, describe] of known) {
    const match = clean.match(pattern);
    if (match) return describe(match);
  }
  const tex = /^! (.+)$/m.exec(clean);
  if (tex) return tex[1];
  const error = /^ERROR:?\s*(.+)$/m.exec(clean);
  return error ? error[1].trim() : "";
}
