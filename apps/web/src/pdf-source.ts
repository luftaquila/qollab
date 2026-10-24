/// <reference types="vite/client" />
import { parse, stringify } from "yaml";
import template from "../../../containers/typst/template.typ?raw";
import defaultTemplate from "../../../containers/typst/typst-template.typ?raw";
import defaultShow from "../../../containers/typst/typst-show.typ?raw";
import qollab from "../../../containers/typst/qollab.lua?raw";
import qmd from "../../../containers/typst/qmd.lua?raw";
import highlight from "../../../containers/typst/arrow-light.theme?raw";
import documentFormat from "../../../containers/typst/document-format.typ?raw";
import { numberDocument } from "../../../packages/codec/src/document-numbering";
import {
  defaultNumbering,
  numberingSchema,
  type Numbering,
} from "../../../packages/codec/src/numbering";

export type PdfFiles = Record<string, Uint8Array>;
const decode = (b: Uint8Array | undefined) =>
  b ? new TextDecoder("utf-8", { fatal: true }).decode(b) : "";
export function resolvePath(base: string, value: string) {
  const parts = base.split("/").slice(0, -1);
  for (const part of value.split("/")) {
    if (part === "..") {
      if (!parts.length) throw new Error("INVALID_PATH");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  if (value.startsWith("/") || /^[\w+.-]+:/.test(value))
    throw new Error("INVALID_PATH");
  return parts.join("/");
}
/** Mirrors render.py's settings merge and reuses its actual templates/filters. */
export function preparePdf(
  files: PdfFiles,
  target: string,
  numbering?: Numbering,
) {
  const source = decode(files[target]);
  if (!files[target]) throw new Error("NOT_FOUND");
  const front = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  let body = front ? source.slice(front[0].length) : source;
  let settings: Record<string, any> = {};
  let partials: string[] = [];
  for (const [text, base] of [
    [decode(files["_quarto.yml"] || files["_quarto.yaml"]), ""],
    [front?.[1] || "", target],
  ]) {
    const data = parse(text, { maxAliasCount: 0 });
    if (!data || typeof data !== "object") continue;
    const { format, ...rest } = data;
    for (const options of [rest, format?.typst || format?.pdf || {}]) {
      if (typeof options !== "object") continue;
      if (options["template-partials"])
        partials = [options["template-partials"]]
          .flat()
          .map((p) => resolvePath(base, String(p)));
      settings = {
        ...settings,
        ...options,
        crossref: { ...settings.crossref, ...options.crossref },
      };
    }
  }
  const korean = String(settings.lang || "en").startsWith("ko");
  const crossref = {
    "fig-title": korean ? "그림" : "Figure",
    "tbl-title": korean ? "표" : "Table",
    "eq-prefix": korean ? "방정식" : "Equation",
    "sec-prefix": korean ? "섹션" : "Section",
    ...settings.crossref,
  };
  crossref["fig-prefix"] ??= crossref["fig-title"];
  crossref["tbl-prefix"] ??= crossref["tbl-title"];
  const metadata: Record<string, any> = {
    ...settings,
    papersize: settings.papersize || "us-letter",
    columns: settings.columns || 1,
    "page-numbering":
      settings["page-numbering"] === false
        ? undefined
        : settings["page-numbering"] === true
          ? "1"
          : (settings["page-numbering"] ?? "1"),
    "toc-depth": settings["toc-depth"] ?? 3,
    "toc-title":
      settings["toc-title"] || (korean ? "목차" : "Table of contents"),
    "abstract-title":
      settings["abstract-title"] || (korean ? "초록" : "Abstract"),
    "fig-cap-location": settings["fig-cap-location"] || "bottom",
    "tbl-cap-location": settings["tbl-cap-location"] || "top",
    crossref,
    "qollab-callout": Object.fromEntries(
      ["note", "tip", "warning", "important", "caution"].map((key, i) => [
        key,
        korean
          ? ["참고", "팁", "경고", "중요", "주의"][i]
          : key[0].toUpperCase() + key.slice(1),
      ]),
    ),
  };
  if (metadata["number-sections"] && !metadata["section-numbering"])
    metadata["section-numbering"] = "1.1.a";
  if (metadata.author) metadata.author = [metadata.author].flat().map(String);
  if (typeof metadata.bibliography === "string")
    metadata.bibliography = [metadata.bibliography];
  delete metadata["template-partials"];
  delete metadata["header-includes"];
  delete metadata.format;
  const inputs: Record<string, string | Blob> = {
    "template.typ": template,
    "typst-template.typ": defaultTemplate,
    "typst-show.typ": defaultShow,
    "qollab.lua": qollab,
    "qmd.lua": qmd,
    "arrow-light.theme": highlight,
  };
  for (const path of partials) {
    const name = path.split("/").at(-1)!;
    if (!["typst-template.typ", "typst-show.typ"].includes(name))
      throw new Error("Unsupported template partial: " + name);
    if (!files[path]) throw new Error("Missing template partial: " + path);
    inputs[name] = decode(files[path]);
  }
  const numbers = numberingSchema.parse(numbering || defaultNumbering());
  const documentNumbering = numberDocument(source, numbers);
  const assets: PdfFiles = {
    ".qollab/document-format.typ": new TextEncoder().encode(documentFormat),
    ".qollab/document-numbering.json": new TextEncoder().encode(
      JSON.stringify(documentNumbering),
    ),
  };
  inputs["template.typ"] = template.replace(
    "$body$",
    "#show: document-format.apply\n$body$",
  );
  body = body.replace(
    /^([ \t]*(?:`{3,}|~{3,})[ \t]*)\{([A-Za-z][\w+-]*)[^}\n]*\}[ \t]*$/gm,
    "$1{.$2 .cell-code}",
  );
  metadata["qollab-scan"] = Object.fromEntries(
    Object.entries({
      latex: /\\[A-Za-z]/,
      labels: /\\label\b/,
      equations: /\{#eq-/,
      shortcodes: /\{\{</,
      references: /@(?:fig|tbl|eq|sec)-/,
    }).map(([key, re]) => [key, re.test(body)]),
  );
  inputs["metadata.yml"] = stringify(metadata);
  if (settings["header-includes"])
    inputs["template.typ"] = String(inputs["template.typ"]).replace(
      "$for(header-includes)$\n$header-includes$\n\n$endfor$",
      [settings["header-includes"]].flat().join("\n"),
    );
  const style =
    String(inputs["typst-template.typ"]) + String(inputs["typst-show.typ"]);
  const fonts = [
    "Pretendard-Regular.ttf",
    "Pretendard-Bold.ttf",
    "NewCMMath-Book.otf",
    "NotoSansCJKkr-Regular.otf",
  ];
  if (style.includes("Noto Serif CJK KR"))
    fonts.push(
      "NotoSerifCJKkr-Regular.otf",
      "NotoSerifCJKkr-Bold.otf",
      "NotoSansCJKkr-Bold.otf",
    );
  if (style.includes("DejaVu Sans Mono")) fonts.push("DejaVuSansMono.ttf");
  if (style.includes("Noto Sans Mono CJK KR"))
    fonts.push("NotoSansMonoCJKkr-Regular.otf");
  if (style.includes("Latin Modern Math")) fonts.push("latinmodern-math.otf");
  return {
    body,
    inputs,
    assets,
    fonts,
    options: {
      from: "markdown",
      to: "typst",
      standalone: true,
      template: "template.typ",
      wrap: "none",
      "syntax-highlighting": "arrow-light.theme",
      "metadata-files": ["metadata.yml"],
      filters: [
        { type: "lua", path: "qollab.lua" },
        { type: "lua", path: "qmd.lua" },
      ],
    },
  };
}
