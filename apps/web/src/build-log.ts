import { t, fmt } from "./i18n";
// Pandoc/Typst logs mix progress, warnings and the error. Pull out the line
// that explains a failure so people do not have to read the whole log.
const known: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/Unsupported render option: (\S+)/, (m) => fmt("errOption", { name: m[1] })],
  [/Font is not installed/, () => t("errFontPolicy")],
  [/Template partials must be \.typ files in the project/, () => t("errPartials")],
  [/Executable cells and shortcodes are disabled/, () => t("errExecutable")],
  [/Remote images are disabled/, () => t("errRemoteImage")],
  [/RENDER_TIMEOUT/, () => t("errTimeout")],
  [/error: file not found \(searched at ([^)]+)\)/, (m) => fmt("errFile", { name: m[1].replace(/^\/work\//, "") })],
  [/Template partial not found: (\S+)/, (m) => fmt("errFile", { name: m[1] })],
  [/error: unknown variable: (\S+)/, (m) => fmt("errCommand", { name: m[1] })],
];
export function summarizeLog(log?: string) {
  if (!log) return "";
  const clean = log.replace(/\x1b\[[0-9;]*m/g, "");
  for (const [pattern, describe] of known) {
    const match = clean.match(pattern);
    if (match) return describe(match);
  }
  const typst = /^(?:\[typst\]:.*?)?error: (.+)$/m.exec(clean);
  if (typst) return typst[1].trim();
  // Pandoc: "Error running filter …", "Error parsing YAML …".
  const pandoc = /^(Error\b.+)$/m.exec(clean);
  if (pandoc) return pandoc[1].trim();
  const error = /^ERROR:?\s*(.+)$/m.exec(clean);
  return error ? error[1].trim() : "";
}
