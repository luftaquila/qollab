import { describe, expect, it } from "vitest";
import {
  defaultNumbering,
  defaultLevel,
  headingNumbering,
  formatNumber,
  numberSymbol,
} from "../packages/codec/src/numbering";
import { renderDocument } from "../apps/web/src/web-document";
const options = { project: "test-project", path: "rules/EV.qmd" };
describe("web chapters and optional numbering", () => {
  it("formats arbitrary heading text and only interprets explicitly supplied prefix rules", () => {
    const numbering = defaultNumbering();
    numbering.headings.enabled = true;
    numbering.headings.levels[0].format = "제{n}조";
    numbering.headings.levels[1].format = "{n}항";
    numbering.headings.rules.push({
      ...defaultLevel("전기 {n}조"),
      match: "EV{n}",
    });
    const source = "# 일반 사항\n\n## 설명\n\n# EV2 전기\n\n# CV2 다른 원문";
    const before = renderDocument(source, options),
      after = renderDocument(source, { ...options, numbering });
    expect(after.headings.map((h) => h.id)).toEqual(
      before.headings.map((h) => h.id),
    );
    expect(after.headings.map((h) => h.text)).toEqual([
      "제1조 일반 사항",
      "1항 설명",
      "전기 2조 전기",
      "제3조 CV2 다른 원문",
    ]);
    expect(after.source).toBe(source);
    expect(defaultNumbering().headings.rules).toEqual([]);
    const custom = defaultNumbering();
    custom.headings.enabled = true;
    custom.headings.levels[0] = {
      ...defaultLevel("부록 {n}"),
      style: "custom",
      symbols: ["갑", "을"],
    };
    const heading = headingNumbering(custom);
    expect(heading("내용", 1)).toBe("부록 갑 내용");
    expect(heading("내용", 1)).toBe("부록 을 내용");
  });
  it("uses literal source prefixes with nested numbers and no regex interpretation", () => {
    const settings = defaultNumbering();
    settings.headings.enabled = true;
    settings.headings.rules = [
      { ...defaultLevel("상위 {n}"), match: "X{n}" },
      { ...defaultLevel("제{1}조 {n}항"), match: "X{1}.{n}" },
      { ...defaultLevel("문단 {n}"), match: "[.*]{n}" },
    ];
    const heading = headingNumbering(settings);
    expect(heading("X2.3 항목", 2)).toBe("제2조 3항 항목");
    expect(heading("[.*]4 항목", 1)).toBe("문단 4 항목");
    settings.headings.rules = [
      { ...defaultLevel(), match: "{1}{2}{3}{4}{5}{6}{7}{n}Z" },
    ];
    expect(headingNumbering(settings)("9".repeat(10000) + "X", 1)).toHaveLength(
      10003,
    );
  });
  it("splits chapters from document structure and keeps preface and cross references", () => {
    const source =
      "Preface\n\n# First {#first}\n\n## Details\n\nOne\n\n```markdown\n# Not a chapter\n```\n\n# Second {#second}\n\nTwo\n\n\\ref{first}";
    const out = renderDocument(source, options);
    expect(out.pages.map((p) => p.title)).toEqual(["First", "Second"]);
    expect(out.pages[0].html).toContain("One");
    expect(out.pages[0].html).not.toContain("Two");
    expect(out.pages[1].html).toContain('href="#first"');
    expect(out.introduction).toContain("Preface");
    expect(out.source).toBe(source);
  });
  it("numbers lists by level and handles starts, multi-letter and circled overflow", () => {
    expect(numberSymbol(27, { style: "lower-alpha", symbols: [] })).toBe("aa");
    expect(numberSymbol(15, { style: "korean", symbols: [] })).toBe("가가");
    expect(numberSymbol(21, { style: "circled", symbols: [] })).toBe("(21)");
    const out = renderDocument(
      "3. first\n   1. child\n      1. grandchild\n4. next",
      {
        ...options,
        numbering: {
          ...defaultNumbering(),
          lists: {
            enabled: true,
            levels: [
              { ...defaultLevel("{n}"), style: "circled" },
              { ...defaultLevel("{n}목"), style: "korean" },
              { ...defaultLevel("({n})"), style: "lower-alpha" },
            ],
          },
        },
      },
    );
    expect(out.html).toContain('data-marker="③"');
    expect(out.html).toContain('data-marker="가목"');
    expect(out.html).toContain('data-marker="(a)"');
    expect(out.html).toContain('data-marker="④"');
  });
  it("preserves source numbering until the user explicitly enables an override", () => {
    const source = "## EV2 Safety\n\n3. original\n   1. child";
    const out = renderDocument(source, options);
    expect(out.html).toContain("EV2 Safety");
    expect(out.html).toContain('<ol start="3">');
    expect(out.html).not.toContain("data-marker");
    expect(out.source).toBe(source);
    expect(defaultNumbering().headings.enabled).toBe(false);
    expect(defaultNumbering().lists.enabled).toBe(false);
  });
  it("renders Typst title and table markup without executing code or changing source", () => {
    const source =
      '```{=typst}\n#title-page[#text(weight: "bold", size: 24pt)[Rule book]]\n#rule-table(columns: (1fr, 1fr,), shade-rows: (0,), [A], [B], [one], [<script>two</script>])\n```';
    const out = renderDocument(source, options);
    expect(out.html).toContain("Rule book");
    expect(out.html).toContain("font-size:24pt");
    expect(out.html).not.toMatch(/document-title-page|document-vspace/);
    expect(out.html).toContain("<table");
    expect(out.html).toContain("&lt;script&gt;two&lt;/script&gt;");
    expect(out.html).not.toMatch(/#title-page|#rule-table|<script>/);
    expect(out.warnings).toContain("Typst: title-page");
    expect(out.source).toBe(source);
  });
  it("does not infer web numbering or styling from PDF template implementation details", () => {
    const source =
      "# Chapter\n\n## Article {#article}\n\n1. Original\n   1. Child\n\n\\ref{article}";
    const projectOptions = {
      ...options,
      files: [
        {
          path: "template.typ",
          source:
            '#let revised-mark = "fsk-revised"\n#let enum-labels = ("①", "1.", "가.", "a.")',
        },
      ],
    };
    const out = renderDocument(source, projectOptions);
    expect(out.html).not.toContain("제1장");
    expect(out.headings[0].text).toBe("Chapter");
    expect(out.headings[1].text).toBe("Article");
    expect(out.html).not.toContain("data-marker");
    expect(out.source).toBe(source);
  });
  it("escapes hostile content and routes project assets through authenticated resources", () => {
    const out = renderDocument(
      "# EV2 <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![safe](../assets/a.png)\n\n![remote](https://attacker.invalid/a.png)",
      options,
    );
    expect(out.html).not.toMatch(
      /<script|onerror="|href="javascript:|src="https:\/\/attacker/,
    );
    expect(out.html).toContain(
      "/api/projects/test-project/resource?path=assets%2Fa.png",
    );
    expect(out.html).toContain("&lt;script&gt;");
  });
});
