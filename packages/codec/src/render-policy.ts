import { parseDocument } from "yaml";
export class PolicyError extends Error {
  code = "RENDER_POLICY";
}
const allowed = new Set([
  "title",
  "subtitle",
  "author",
  "date",
  "lang",
  "format",
  "pdf",
  "toc",
  "toc-depth",
  "number-sections",
  "documentclass",
  "classoption",
  "papersize",
  "fontsize",
  "geometry",
  "colorlinks",
  "linkcolor",
  "urlcolor",
  "citecolor",
  "bibliography",
  "csl",
  "abstract",
  "keywords",
  "fig-cap",
  "fig-alt",
  "fig-width",
  "fig-height",
  "fig-align",
  "tbl-cap",
  "crossref",
  "lof",
  "lot",
  "keep-tex",
  "mainfont",
  "sansfont",
  "monofont",
  "mathfont",
]);
function check(value: unknown, key = "") {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const v of value) {
        if (key === "author" && typeof v !== "string")
          throw new PolicyError("Only plain author names are supported");
        check(v, key);
      }
      return;
    }
    for (const [k, v] of Object.entries(value)) {
      if (!allowed.has(k))
        throw new PolicyError(`Unsupported render option: ${k}`);
      check(v, k);
    }
  } else if (typeof value === "string" && /[\x00]/.test(value))
    throw new PolicyError("NUL in metadata");
  if (
    ["mainfont", "sansfont", "monofont", "mathfont"].includes(key) &&
    typeof value === "string" &&
    ![
      "Noto Serif CJK KR",
      "Noto Sans CJK KR",
      "DejaVu Sans Mono",
      "Latin Modern Math",
    ].includes(value)
  )
    throw new PolicyError("Font is not installed");
  if (key === "format" && typeof value === "string" && value !== "pdf")
    throw new PolicyError("Only PDF is supported");
  if (
    key === "documentclass" &&
    typeof value === "string" &&
    !["article", "report", "book", "scrartcl"].includes(value)
  )
    throw new PolicyError("Unsupported document class");
}
function yaml(source: string) {
  const d = parseDocument(source, {
    uniqueKeys: true,
    maxAliasCount: 0,
  } as any);
  if (d.errors.length || d.warnings.length)
    throw new PolicyError("Invalid YAML");
  const value = d.toJS({ maxAliasCount: 0 });
  check(value);
}
export function renderPolicy(
  files: { path: string; source?: string; bytes?: string }[],
) {
  for (const f of files) {
    if (/\.(ya?ml)$/i.test(f.path)) {
      if (f.path !== "_quarto.yml")
        throw new PolicyError("Only _quarto.yml configuration is supported");
      yaml(f.source || "");
    }
    if (/\.(qmd|md)$/i.test(f.path)) {
      const source = f.source || "",
        front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
      if (front) yaml(front[1]);
      if (
        /^\s*(?:`{3,}|~{3,})\s*\{(?![=])|\{\{<|\{(?:python|r|julia|bash|ojs)\}/im.test(
          source,
        )
      )
        throw new PolicyError("Executable cells and shortcodes are disabled");
      if (
        /(?:https?:\/\/|file:\/\/)/i.test(source) &&
        /!\[.*?\]\((?:https?|file):/i.test(source)
      )
        throw new PolicyError("Remote images are disabled");
    }
  }
}
