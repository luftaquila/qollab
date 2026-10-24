import type { WebFormat } from "../../../packages/codec/src/web-format";

// Interpret a limited set of formatting primitives, with project-owned mappings
// for custom wrappers. This does not execute arbitrary Typst functions.
export const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function group(
  source: string,
  start: number,
): { body: string; end: number } | undefined {
  const open = source[start],
    close = open === "[" ? "]" : open === "(" ? ")" : "}";
  let depth = 1,
    quoted = false;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") {
      i++;
      continue;
    }
    if (source[i] === '"' && open !== "[") {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0)
      return { body: source.slice(start + 1, i), end: i + 1 };
  }
}
function split(source: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '"') {
      for (i++; i < source.length; i++) {
        if (source[i] === "\\") {
          i++;
          continue;
        }
        if (source[i] === '"') break;
      }
    } else if ("([{".includes(source[i])) {
      const g = group(source, i);
      if (g) i = g.end - 1;
    } else if (source[i] === ",") {
      out.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(source.slice(start).trim());
  return out.filter(Boolean);
}
export interface TypstWebOptions {
  format?: WebFormat;
  inline?: boolean;
  heading?: (level: number, text: string) => string;
}
const unquote = (value: string) => {
  try {
    return value.startsWith('"') ? String(JSON.parse(value)) : value;
  } catch {
    return value;
  }
};
function variable(value: string, format?: WebFormat, depth = 0): string {
  const v = value.trim();
  return depth < 8 && format && Object.hasOwn(format.variables, v)
    ? variable(format.variables[v], format, depth + 1)
    : unquote(v);
}
function length(
  value: string,
  format?: WebFormat,
  depth = 0,
): string | undefined {
  if (depth > 8) return;
  const v = variable(value, format);
  if (v === "0") return "0";
  if (/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:pt|px|em|rem|cm|mm|in|%)$/.test(v))
    return v;
  const product = /^(-?[\d.]+)\s*\*\s*(.+)$/.exec(v);
  if (product) {
    const right = length(product[2], format, depth + 1);
    const parts = right && /^(-?[\d.]+)(.*)$/.exec(right);
    const n = parts ? Number(product[1]) * Number(parts[1]) : NaN;
    if (parts && Number.isFinite(n)) return n + parts[2];
  }
}
function color(value: string, format?: WebFormat) {
  let v = variable(value, format);
  const rgb = /^rgb\((.*)\)$/.exec(v);
  if (rgb) {
    v = unquote(rgb[1].trim());
    if (/^[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?$/.test(v)) return `rgb(${v})`;
  }
  return /^(?:#[\da-f]{3,8}|[a-z]+)$/i.test(v) ? v : undefined;
}
const styles = (values: Record<string, string | undefined>) => {
  const css = Object.entries(values)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return css ? ` style="${escapeHtml(css)}"` : "";
};
function textStyle(args: string, format?: WebFormat) {
  const values: Record<string, string | undefined> = {};
  for (const arg of split(args)) {
    const match = /^(\w+):\s*(.*)$/.exec(arg);
    if (!match) continue;
    const [, name, raw] = match,
      v = variable(raw, format);
    if (name === "size") values["font-size"] = length(raw, format);
    if (name === "tracking") values["letter-spacing"] = length(raw, format);
    if (name === "fill") values.color = color(raw, format);
    if (name === "weight" && /^(?:normal|bold|[1-9]00)$/.test(v))
      values["font-weight"] = v;
    if (name === "style" && /^(?:normal|italic|oblique)$/.test(v))
      values["font-style"] = v;
  }
  return styles(values);
}
function headingText(html: string) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:lt|gt|quot|amp);/g,
      (s) => ({ "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&" })[s]!,
    )
    .replace(/\s+/g, " ")
    .trim();
}
export function typstHtml(
  source: string,
  reference: (id: string) => string,
  warnings: Set<string>,
  counter?: (name: string) => string | undefined,
  options: TypstWebOptions = {},
): string {
  const render = (s: string, inline = options.inline) =>
    typstHtml(s, reference, warnings, counter, { ...options, inline });
  let out = "";
  for (let i = 0; i < source.length; ) {
    if (source[i] === "\\" && i + 1 < source.length) {
      out += escapeHtml(source[i + 1]);
      i += 2;
      continue;
    }
    if (source.slice(i, i + 2) === "//") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    const match = /^#([\w.-]+)/.exec(source.slice(i));
    if (!match) {
      out += escapeHtml(source[i++]);
      continue;
    }
    const name = match[1];
    i += match[0].length;
    let args = "",
      body = "";
    if (source[i] === "(") {
      const g = group(source, i);
      if (g) {
        args = g.body;
        i = g.end;
      }
    }
    if (source[i] === "[") {
      const g = group(source, i);
      if (g) {
        body = g.body;
        i = g.end;
      }
    }
    if (source[i] === ";") i++;
    // Content may be passed as a positional argument instead of trailing [].
    if (!body) {
      const content = split(args).find((a) => a.startsWith("["));
      if (content) body = group(content, 0)?.body || "";
    }
    const count = counter?.(name);
    const custom =
      options.format && Object.hasOwn(options.format.functions, name)
        ? options.format.functions[name]
        : undefined;
    if (count !== undefined)
      out += `<span class="document-counter">${escapeHtml(count)}</span>`;
    else if (custom) {
      const inline = ["span", "strong", "em", "u", "small"].includes(
        custom.tag,
      );
      const content = render(body, inline);
      const level = /^h([1-6])$/.exec(custom.tag)?.[1];
      const id =
        level && options.heading?.(Number(level), headingText(content));
      out += `<${custom.tag}${id ? ` id="${escapeHtml(id)}"` : ""} data-web-function="${escapeHtml(name)}"${styles(custom.style)}>${content}</${custom.tag}>`;
    } else if (name === "text") {
      const tag = /weight:\s*"bold"/.test(args) ? "strong" : "span";
      out += `<${tag}${textStyle(args, options.format)}>${render(body, true)}</${tag}>`;
    } else if (name === "align") {
      const alignment = split(args)[0];
      out += /^(left|center|right|justify)$/.test(alignment)
        ? `<div style="text-align:${alignment}">${render(body, false)}</div>`
        : render(body);
    } else if (name === "h" || name === "v") {
      const size = length(split(args)[0] || "", options.format);
      // Flexible page-filling space has no width on a flowing web page.
      out += size
        ? name === "h"
          ? `<span aria-hidden="true" style="display:inline-block;width:${escapeHtml(size)}"></span>`
          : `<div aria-hidden="true" style="height:${escapeHtml(size)}"></div>`
        : " ";
    } else if (["line", "pagebreak"].includes(name)) out += " ";
    else if (name === "strong" || name === "emph" || name === "underline")
      out += `<${{ strong: "strong", emph: "em", underline: "u" }[name]}>${render(body)}</${{ strong: "strong", emph: "em", underline: "u" }[name]}>`;
    else if (name === "ref") {
      const id = /<([\w:.-]+)>/.exec(args)?.[1];
      out += id
        ? `<a href="#${escapeHtml(id)}">${escapeHtml(reference(id))}</a>`
        : "";
    } else if (name === "enum") {
      const items = split(args).filter((x) => x.startsWith("["));
      out +=
        "<ol>" +
        items
          .map((x) => "<li>" + render(group(x, 0)?.body || "") + "</li>")
          .join("") +
        "</ol>";
    } else if (
      name === "table" ||
      (/\bcolumns:/.test(args) && split(args).some((x) => x.startsWith("[")))
    ) {
      const entries = split(args),
        columns = entries.find((x) => x.startsWith("columns:")) || "";
      const count = Math.max(
        1,
        split(columns.slice(columns.indexOf("(") + 1, columns.lastIndexOf(")")))
          .length,
      );
      const cells = entries.filter(
        (x) => x.startsWith("[") || x.startsWith("table.cell"),
      );
      let row = 0,
        col = 0,
        rows = "<tr>",
        occupied: number[][] = [];
      for (const cell of cells) {
        while (occupied[row]?.[col]) col++;
        if (col >= count) {
          rows += "</tr><tr>";
          row++;
          col = 0;
          while (occupied[row]?.[col]) col++;
        }
        const start = cell.indexOf("["),
          g = group(cell, start);
        const rs = Number(
            /rowspan:\s*(\d+)/.exec(cell.slice(0, start))?.[1] || 1,
          ),
          cs = Number(/colspan:\s*(\d+)/.exec(cell.slice(0, start))?.[1] || 1);
        for (let y = row; y < row + rs; y++) {
          occupied[y] ||= [];
          for (let x = col; x < col + cs; x++) occupied[y][x] = 1;
        }
        rows += `<td rowspan="${rs}" colspan="${cs}">${render(g?.body || "")}</td>`;
        col += cs;
      }
      out += `<div class="document-table"><table><tbody>${rows}</tr></tbody></table></div>`;
    } else {
      warnings.add("Typst: " + name);
      const tag = options.inline ? "span" : "div";
      out += body ? `<${tag}>${render(body)}</${tag}>` : "";
    }
  }
  return out.replace(/\n[ \t]*\n/g, "<br>");
}
