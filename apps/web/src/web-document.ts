import MarkdownIt from "markdown-it";
import katex from "katex";
import { typstHtml } from "./web-typst";
import {
  documentBody,
  numberTokens,
} from "../../../packages/codec/src/document-numbering";
import {
  defaultNumbering,
  numberingSchema,
  formatNumber,
  type Numbering,
} from "../../../packages/codec/src/numbering";

export interface WebDocumentOptions {
  project: string;
  resource?: (path: string, image: boolean, hash: string) => string;
  path: string;
  numbering?: Numbering;
}
export interface DocumentHeading {
  id: string;
  text: string;
  level: number;
}
export function renderDocument(source: string, options: WebDocumentOptions) {
  const settings = numberingSchema.parse(
    options.numbering || defaultNumbering(),
  );
  const headings: DocumentHeading[] = [];
  const warnings = new Set<string>();
  const references: Record<string, string> = Object.create(null);
  const rawCache = new WeakMap<object, string>();
  const counterValues = new Map<string, number>();
  const counter = (name: string) => {
    const spec = settings.counters.find((s) => s.name === name);
    if (!spec) return undefined;
    const n = (counterValues.get(name) || 0) + 1;
    counterValues.set(name, n);
    return formatNumber([n], [spec]);
  };
  const rawHtml = (token: { content: string }) => {
    if (!rawCache.has(token))
      rawCache.set(
        token,
        typstHtml(token.content, reference, warnings, counter),
      );
    return rawCache.get(token)!;
  };
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
  const escape = md.utils.escapeHtml;
  const reference = (id: string) => references[id] || id;
  const originalFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, i, opts, env, renderer) =>
    tokens[i].info.trim() === "{=typst}"
      ? rawHtml(tokens[i])
      : originalFence(tokens, i, opts, env, renderer);
  md.inline.ruler.before("backticks", "raw_typst", (state, silent) => {
    if (state.src[state.pos] !== "`") return false;
    const end = state.src.indexOf("`{=typst}", state.pos + 1);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push("raw_typst", "", 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 9;
    return true;
  });
  md.renderer.rules.raw_typst = (tokens, i) => rawHtml(tokens[i]);
  md.inline.ruler.before("escape", "quarto_tex", (state, silent) => {
    const match =
      /^\\(label|cref|ref|textquoteright|clearpage|newpage)(?:\{([^}]*)\})?/.exec(
        state.src.slice(state.pos),
      );
    if (!match) return false;
    if (!silent) {
      const token = state.push("quarto_tex", "", 0);
      token.content = match[2] || "";
      token.meta = match[1];
    }
    state.pos += match[0].length;
    return true;
  });
  md.renderer.rules.quarto_tex = (tokens, i) => {
    const token = tokens[i],
      id = escape(token.content);
    if (token.meta === "label") return `<span id="${id}"></span>`;
    if (token.meta === "textquoteright") return "’";
    if (["clearpage", "newpage"].includes(token.meta)) return "";
    return `<a href="#${id}">${escape(reference(token.content))}</a>`;
  };
  const resolve = (href: string, image = false): string => {
    if (href.startsWith("#")) return href;
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href))
      return !image && /^(https?:|mailto:)/i.test(href) ? href : "";
    try {
      const url = new URL(href, "https://project.invalid/" + options.path);
      const path = decodeURIComponent(url.pathname.slice(1));
      if (options.resource) return options.resource(path, image, url.hash);
      return image
        ? `/api/projects/${encodeURIComponent(options.project)}/resource?path=${encodeURIComponent(path)}`
        : `/docs/?project=${encodeURIComponent(options.project)}&path=${encodeURIComponent(path)}${url.hash}`;
    } catch {
      return "";
    }
  };
  md.renderer.rules.image = (tokens, i) => {
    const token = tokens[i];
    const src = resolve(token.attrGet("src") || "", true);
    if (!src) return `<span>${escape(token.content)}</span>`;
    const width = token.attrGet("width"),
      id = token.attrGet("id");
    const img = `<img src="${escape(src)}" alt="${escape(token.content)}" loading="lazy"${width ? ` style="width:${escape(width)}"` : ""}>`;
    return token.meta?.figure
      ? `<figure${id ? ` id="${escape(id)}"` : ""}>${img}<figcaption>${escape(token.meta.caption)}</figcaption></figure>`
      : img;
  };
  md.renderer.rules.link_open = (tokens, i, _o, _e, renderer) => {
    tokens[i].attrSet("href", resolve(tokens[i].attrGet("href") || ""));
    tokens[i].attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, i, _o);
  };
  md.inline.ruler.before("escape", "qollab_math", (state, silent) => {
    if (
      state.src[state.pos] !== "$" ||
      state.src[state.pos + 1] === "$" ||
      state.src[state.pos - 1] === "$"
    )
      return false;
    const end = state.src.indexOf("$", state.pos + 1);
    if (end <= state.pos + 1 || state.src.slice(state.pos, end).includes("\n"))
      return false;
    if (!silent) {
      const token = state.push("qollab_math", "", 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.renderer.rules.qollab_math = (tokens, i) =>
    katex.renderToString(tokens[i].content, {
      trust: false,
      throwOnError: false,
      strict: "ignore",
      maxExpand: 1000,
    });
  md.block.ruler.before(
    "fence",
    "qollab_math_block",
    (state, start, end, silent) => {
      const line = state.src
        .slice(state.bMarks[start] + state.tShift[start], state.eMarks[start])
        .trim();
      if (!line.startsWith("$$")) return false;
      let last = start,
        value = line.slice(2);
      if (value.endsWith("$$")) value = value.slice(0, -2);
      else {
        const parts = [value];
        for (last = start + 1; last < end; last++) {
          const next = state.src.slice(
            state.bMarks[last] + state.tShift[last],
            state.eMarks[last],
          );
          if (next.trim() === "$$") break;
          parts.push(next);
        }
        if (last === end) return false;
        value = parts.join("\n");
      }
      if (!silent) {
        const token = state.push("qollab_math_block", "", 0);
        token.content = value;
        token.block = true;
        token.map = [start, last + 1];
      }
      state.line = last + 1;
      return true;
    },
  );
  md.renderer.rules.qollab_math_block = (tokens, i) =>
    katex.renderToString(tokens[i].content, {
      displayMode: true,
      trust: false,
      throwOnError: false,
      strict: "ignore",
      maxExpand: 1000,
    });
  const body = documentBody(source);
  if (/(^|\n):::|\\(?:begin|textcolor|ul)\b/.test(body))
    warnings.add("webUnsupported");
  const tokens = md.parse(body, {});
  Object.assign(references, numberTokens(tokens, settings).references);
  const visible = tokens;
  const used = new Set<string>();
  for (let i = 0; i < visible.length; i++) {
    const token = visible[i];
    if (token.type === "heading_open") {
      const inline = visible[i + 1];
      const label = /\s*\{#([\w:.-]+)\}\s*$/.exec(inline.content)?.[1];
      const original = inline.content
        .replace(/\s*\{#[\w:.-]+\}\s*$/, "")
        .replaceAll("\\textquoteright{}", "’");
      const text = token.meta.numbering.title;
      const slug =
        original
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "section";
      const base = label || slug;
      let id = base,
        suffix = 1;
      while (used.has(id)) id = base + "-" + ++suffix;
      used.add(id);
      token.attrSet("id", id);
      inline.content = text;
      inline.children = md.parseInline(text, {})[0].children;
      headings.push({ id, text, level: Number(token.tag.slice(1)) });
    }
  }
  const html = md.renderer.render(visible, md.options, {});
  const chapterLevel = Math.min(...headings.map((h) => h.level));
  const starts = visible.flatMap((token, i) =>
    token.type === "heading_open" && Number(token.tag.slice(1)) === chapterLevel
      ? [i]
      : [],
  );
  const pages = starts.map((start, i) => {
    const end = starts[i + 1] ?? visible.length;
    const id = visible[start].attrGet("id")!;
    const pageHeadings = headings.filter((h) =>
      visible
        .slice(start, end)
        .some((t) => t.type === "heading_open" && t.attrGet("id") === h.id),
    );
    return {
      id,
      title: pageHeadings[0].text,
      headings: pageHeadings,
      html: md.renderer.render(visible.slice(start, end), md.options, {}),
    };
  });
  return {
    html,
    source,
    headings,
    pages,
    introduction: md.renderer.render(
      visible.slice(0, starts[0] ?? visible.length),
      md.options,
      {},
    ),
    warnings: [...warnings],
  };
}
