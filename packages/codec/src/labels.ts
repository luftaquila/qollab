// Quarto/Pandoc syntax for labels and references that the visual editor keeps
// as editable nodes. Anything more complex (citation lists, locators, classes,
// nested formatting inside a labelled span) still becomes a raw block.
export const LABEL_ID = "[a-zA-Z][\\w:-]*";
/** `[text]{#id}`: a labelled span of plain text. */
const span = `\\[([^\\[\\]\\n*_\`\\\\{}<>@$]+)\\]\\{#(${LABEL_ID})\\}`;
/** `[@id]` or `@id`: a cross-reference or citation without locators. */
const reference = `\\[@(${LABEL_ID})\\]|(?<![\\w@\\[\\]])@(${LABEL_ID})`;
/** `[text]{.underline}`: Quarto's underline. */
const underline = `\\[([^\\[\\]\\n*_\`\\\\{}<>@$]+)\\]\\{\\.underline\\}`;
/** Plain text inside a LaTeX argument, after Markdown has read its escapes. */
const latexText = `(?:[^{}\\\\\\n]|\\\\char\\d{1,7}\\{\\}|\\\\textbackslash\\{\\}|\\\\[%&#$_{}])`;
/** Formatting the editor writes inside `\textcolor` for underlined, bold… text. */
const latexFormat = `\\\\(ul|textbf|textit|texttt)\\{(${latexText}*)\\}`;
const refCommands = ["label", "ref", "cref", "Cref", "pageref", "eqref", "autoref", "nameref"];
/** A reference or label inside `\textcolor`. Group: 1 the whole command. */
const latexRef = `(\\\\(?:${refCommands.join("|")})\\{${LABEL_ID}\\})`;
/**
 * `\textcolor{red}{text}` or `\textcolor[HTML]{1C7667}{text}` around plain or
 * formatted text and references; those patterns are embedded without groups.
 */
const ungrouped = (pattern: string) => pattern.replace(/\((?!\?)/g, "(?:");
const color = `\\\\textcolor(?:\\[HTML\\]\\{([0-9A-Fa-f]{6})\\}|\\{([A-Za-z]+)\\})\\{((?:${ungrouped(latexFormat)}|${ungrouped(latexRef)}|${latexText})+)\\}`;
/**
 * A LaTeX command left in text: `\ref{id}`, `\label{id}` and the like, or a
 * command without arguments (`\newpage`, `\smallpar{}`). Commands that take
 * text stay text. Groups: 1 the label id, 2 the command name.
 */
const texCommand = `\\\\(?:(?:${refCommands.join("|")})\\{(${LABEL_ID})\\}|([a-zA-Z]+)(?:\\{\\}|(?![a-zA-Z{[])))`;
export const labelSpans = () => new RegExp(span, "g");
export const underlines = () => new RegExp(underline, "g");
export const colors = () => new RegExp(color, "g");
export const references = () => new RegExp(reference, "g");
export const texCommands = () => new RegExp(texCommand, "g");
/** Groups: 1 command (ul, textbf, textit, texttt), 2 escaped text, 3 a reference or label. */
export const latexFormats = () => new RegExp(`${latexFormat}|${latexRef}`, "g");
/**
 * Inline syntax in one pass. Groups: 1–2 labelled span, 3 underline,
 * 4–6 color (hex, name, text), 7–8 reference (bracketed, bare), 9–10 LaTeX
 * command (label id, command name).
 */
export const inlineLabels = () =>
  new RegExp(`${span}|${underline}|${color}|${reference}|${texCommand}`, "g");
/** Text commands the editor shows as the character they print. */
const TEX_SYMBOLS: Record<string, string> = {
  textquoteright: "\u2019",
  textquoteleft: "\u2018",
  textquotedblright: "\u201d",
  textquotedblleft: "\u201c",
  textendash: "\u2013",
  textemdash: "\u2014",
  textellipsis: "\u2026",
  ldots: "\u2026",
  textbullet: "\u2022",
  textperiodcentered: "\u00b7",
  textdegree: "\u00b0",
  textasciitilde: "~",
  textbackslash: "\\",
  copyright: "\u00a9",
  textregistered: "\u00ae",
  texttrademark: "\u2122",
  S: "\u00a7",
  P: "\u00b6",
};
const PAGE_BREAKS = ["newpage", "clearpage", "cleardoublepage", "pagebreak"];
/**
 * How the editor shows a command chip: as the character it prints, as a page
 * break, or as its source.
 */
export function texDisplay(source: string): { kind: "symbol"; text: string } | { kind: "pagebreak" } | null {
  const m = /^\\([a-zA-Z]+)(?:\{\})?$/.exec(source);
  if (!m) return null;
  if (TEX_SYMBOLS[m[1]]) return { kind: "symbol", text: TEX_SYMBOLS[m[1]] };
  return PAGE_BREAKS.includes(m[1]) ? { kind: "pagebreak" } : null;
}
/** What a LaTeX command chip stands for: a reference, a label or other. */
export function texKind(source: string) {
  if (source.startsWith("$$")) return { kind: "math" as const, id: "" };
  const m = /^\\(label|ref|cref|Cref|pageref|eqref|autoref|nameref)\{([^}]*)\}$/.exec(source);
  if (!m) return { kind: "command" as const, id: "" };
  return { kind: m[1] === "label" ? ("label" as const) : ("ref" as const), id: m[2] };
}
// Text inside \textcolor is read by LaTeX, but Markdown parses it first: it drops
// backslash escapes and reads `*`, `[`, `<`… as syntax. Characters special to
// either are written as XeLaTeX \char codes, which Markdown leaves alone.
export const escapeLatex = (text: string) =>
  text.replace(/[\\{}$&#^_%~*`[\]<>]/g, (c) =>
    "$&#_%".includes(c) ? "\\" + c : `\\char${c.charCodeAt(0)}{}`,
  );
export const unescapeLatex = (text: string) =>
  text.replace(/\\char(\d{1,7})\{\}|\\textbackslash\{\}|\\([%&#$_{}])/g, (all, code, char) =>
    code ? (Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : all) : (char ?? "\\"),
  );
/** ` {#id}` at the end of an ATX heading line. */
export const headingLabel = new RegExp(`[ \\t]+\\{#(${LABEL_ID})\\}[ \\t]*$`);
export const validLabel = (id: string) => new RegExp(`^${LABEL_ID}$`).test(id);
/** Quarto numbers references with these prefixes (e.g. @fig-chart → Figure 1). */
export const crossrefPrefixes = ["fig", "tbl", "sec", "eq", "lst", "thm"];
export const labelKind = (id: string) => {
  const prefix = id.split("-")[0];
  return crossrefPrefixes.includes(prefix) && id.includes("-") ? prefix : "span";
};
/** Removes the syntax handled visually so only unsupported syntax remains. */
export function withoutLabels(block: string) {
  let probe = block
    .replace(labelSpans(), "$1")
    .replace(underlines(), "$1")
    .replace(colors(), "$3")
    .replace(references(), "");
  if (/^#{1,6}[ \t]/.test(block) && !block.trimEnd().includes("\n"))
    probe = probe.replace(headingLabel, "");
  return probe;
}
