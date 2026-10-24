import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { renderDocument } from "../apps/web/src/web-document";
import { preparePdf } from "../apps/web/src/pdf-source";
import {
  readWebFormat,
  webFormatSource,
} from "../packages/codec/src/web-format";
const webFormat = readFileSync("tests/fixtures/web-format.yml", "utf8");
const options = { project: "test", path: "guide.qmd", webFormat };
const raw = (s: string) => "```{=typst}\n" + s + "\n```\n";

describe("project-owned web formatting", () => {
  it("renders nested wrappers and literal formatting as searchable HTML without changing source", () => {
    const source =
      raw('#hero[#text(weight: "bold", size: 24pt, tracking: 0.05em)[Title]]') +
      "\n# Chapter\n\nBefore `#notice[changed]`{=typst} after.\n\n" +
      raw(
        "#table(columns: (1fr, 1fr), [A], [#notice[changed cell]])\nDate: #field[#h(2em)#h(2em)]",
      );
    const doc = renderDocument(source, options),
      dom = new JSDOM(doc.html).window.document;
    expect(doc.warnings).toEqual([]);
    expect(doc.source).toBe(source);
    expect(dom.querySelector("header")?.style.textAlign).toBe("center");
    expect(dom.querySelector("header strong")?.getAttribute("style")).toContain(
      "font-size:24pt",
    );
    expect(
      dom.querySelector("p > span[data-web-function=notice]")?.textContent,
    ).toBe("changed");
    expect(
      dom.querySelector<HTMLElement>("td span[data-web-function=notice]")?.style
        .color,
    ).toBe("rgb(0, 0, 255)");
    const field = dom.querySelector("[data-web-function=field]")!;
    expect(field.querySelectorAll('span[style*="width:2em"]')).toHaveLength(2);
    expect(field.getAttribute("style")).toContain(
      "border-bottom:0.5pt solid currentColor",
    );
  });
  it("keeps mapped headings in source order, with unique stable anchors and existing chapter boundaries", () => {
    const source =
      "# First\n\n" +
      raw("#appendix-heading[Details]") +
      "\n## Markdown\n\n" +
      raw("#appendix-heading[Details]") +
      "\n# Second\n";
    const doc = renderDocument(source, options);
    expect(doc.headings.map((h) => h.text)).toEqual([
      "First",
      "Details",
      "Markdown",
      "Details",
      "Second",
    ]);
    expect(new Set(doc.headings.map((h) => h.id)).size).toBe(5);
    expect(doc.pages.map((p) => p.title)).toEqual(["First", "Second"]);
    expect(doc.pages[0].headings).toEqual(doc.headings.slice(0, 4));
    expect(doc.pages[0].html).toContain('id="web-details-2"');
    expect(doc.html).toContain('id="web-details-2"');
  });
  it("resolves explicit spacing constants and supports ordinary Typst primitives without project-specific names", () => {
    const doc = renderDocument(
      raw(
        "#align(right)[Right]\n#v(2 * unit)\n#text(fill: rgb(0,0,255), size: 1.2em)[Blue]",
      ),
      options,
    );
    const dom = new JSDOM(doc.html).window.document;
    expect(
      dom.querySelector<HTMLElement>('div[style*="text-align"]')?.style
        .textAlign,
    ).toBe("right");
    expect(doc.html).toContain("height:5pt");
    expect(
      dom.querySelector<HTMLElement>('span[style*="color"]')?.style.color,
    ).toBe("rgb(0, 0, 255)");
  });
  it("isolates project definitions, reports missing functions, and shows invalid YAML instead of hiding it", () => {
    const source = raw("#notice[Changed] #unmapped[Keep this text]");
    const a = renderDocument(source, options);
    const b = renderDocument(source, { ...options, webFormat: undefined });
    expect(a.warnings).toEqual(["Typst: unmapped"]);
    expect(b.warnings).toEqual(["Typst: notice", "Typst: unmapped"]);
    expect(b.html).not.toContain("data-web-function");
    const invalid = renderDocument(source, {
      ...options,
      webFormat: "version: [",
    });
    expect(invalid.warnings[0]).toContain("웹 서식 정의 오류");
    expect(invalid.html).toContain("Keep this text");
    expect(
      webFormatSource([{ path: "_qollab-web.yml", source: webFormat }]),
    ).toBe(webFormat);
  });
  it.each([
    "version: 1\nfunctions: { x: { tag: script } }",
    "version: 1\nfunctions: { x: { tag: span, onclick: alert } }",
    'version: 1\nfunctions: { x: { tag: span, style: { color: "red;position:fixed" } } }',
    'version: 1\nfunctions: { x: { tag: span, style: { color: "url(https://example.com/)" } } }',
  ])("rejects executable or escaping formatting declarations", (source) => {
    expect(readWebFormat(source).format).toBeUndefined();
    expect(readWebFormat(source).warning).toBeTruthy();
  });
  it("preserves the PDF inputs when a web template is added", () => {
    const encode = (s: string) => new TextEncoder().encode(s);
    const files = { "guide.qmd": encode("# Original\n\nBody\n") };
    expect(
      preparePdf(
        { ...files, "_qollab-web.yml": encode(webFormat) },
        "guide.qmd",
      ),
    ).toEqual(preparePdf(files, "guide.qmd"));
  });
});
