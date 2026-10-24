// Extract readable content from legacy raw Typst blocks without executing them.
// Print-only dimensions, spacing, alignment and page breaks are discarded.
// New content uses Markdown; this bridge keeps existing tables and text readable.
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
export function typstHtml(
  source: string,
  reference: (id: string) => string,
  warnings: Set<string>,
  counter?: (name: string) => string | undefined,
): string {
  const render = (s: string) => typstHtml(s, reference, warnings, counter);
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
    const count = counter?.(name);
    if (count !== undefined)
      out += `<span class="document-counter">${escapeHtml(count)}</span>`;
    else if (name === "text")
      out += /weight:\s*"bold"/.test(args)
        ? `<strong>${render(body)}</strong>`
        : render(body);
    else if (name === "align") out += render(body);
    else if (["v", "h", "line", "pagebreak"].includes(name)) out += " ";
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
      out += body ? `<div>${render(body)}</div>` : "";
    }
  }
  return out.replace(/\n[ \t]*\n/g, "<br>");
}
