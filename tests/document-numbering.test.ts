import { describe, expect, it } from "vitest";
import {
  defaultLevel,
  defaultNumbering,
} from "../packages/codec/src/numbering";
import { numberDocument } from "../packages/codec/src/document-numbering";
import { renderDocument } from "../apps/web/src/web-document";
import { preparePdf } from "../apps/web/src/pdf-source";

function settings() {
  const s = defaultNumbering();
  s.headings.enabled =
    s.lists.enabled =
    s.figures.enabled =
    s.bullets.enabled =
      true;
  s.headings.levels[0].format = "제{n}장";
  Object.assign(s.headings.levels[1], {
    format: "제{n}조",
    title: "{label} ({title})",
    reset: "document",
  });
  s.lists.levels[0] = {
    ...defaultLevel("{n}"),
    style: "circled",
    reference: "{h2} {n}항",
  };
  s.lists.levels[1] = {
    ...defaultLevel("{n}."),
    style: "korean",
    reference: "{h2} {1}항 {n}번",
  };
  s.figures.label.format = "그림 {n}";
  s.counters = [{ ...defaultLevel("[부록 {n}]"), name: "supplement" }];
  return s;
}
const source = `# 첫 장

## 첫 조 {#first}

1. 항목 \\label{item}
   1. 하위 \\label{child}

## 둘째 조

# 다음 장

## 셋째 조 {#last}

![설명](image.png){#fig-example width=50%}

\\ref{first}, \\ref{last}, \\ref{item}, \\ref{child}, \\cref{fig-example}

~~~{=typst}
#supplement()
~~~
`;
describe("shared document numbering", () => {
  it("shares continuous headings, caption labels and nested references between web and PDF", () => {
    const cfg = settings();
    const index = numberDocument(source, cfg);
    expect(index.headings.map((h) => h.title)).toEqual([
      "제1장 첫 장",
      "제1조 (첫 조)",
      "제2조 (둘째 조)",
      "제2장 다음 장",
      "제3조 (셋째 조)",
    ]);
    expect(index.references).toMatchObject({
      first: "제1조",
      last: "제3조",
      item: "제1조 1항",
      child: "제1조 1항 1번",
      "fig-example": "그림 1",
    });
    const pdf = preparePdf(
      { "main.qmd": new TextEncoder().encode(source) },
      "main.qmd",
      cfg,
    );
    expect(
      JSON.parse(
        new TextDecoder().decode(pdf.assets[".qollab/document-numbering.json"]),
      ),
    ).toEqual(index);
    const web = renderDocument(source, {
      project: "p",
      path: "main.qmd",
      numbering: cfg,
    });
    expect(web.headings.map((h) => h.text)).toEqual(
      index.headings.map((h) => h.title),
    );
    expect(web.html).toContain('data-marker="①"');
    expect(web.html).toContain('data-marker="가."');
    expect(web.html).toContain("<figcaption>그림 1. 설명</figcaption>");
    expect(web.html).toContain('style="width:50%"');
    for (const [id, text] of Object.entries(index.references))
      expect(web.html).toContain(`href="#${id}">${text}</a>`);
    expect(web.html).toContain("[부록 1]");
    expect(web.pages.at(-1)!.html).toContain("[부록 1]");
    expect(web.pages.at(-1)!.html).not.toContain("[부록 2]");
  });
  it("recomputes both outputs when arbitrary display formats change", () => {
    const cfg = settings();
    Object.assign(cfg.headings.levels[1], {
      format: "Article {n}",
      title: "[{label}] {title}",
      reset: "parent",
    });
    cfg.lists.levels[0].reference = "{h2} / item {n}";
    cfg.figures.label.format = "Plate {n}";
    cfg.figures.caption = "{caption} ({label})";
    const index = numberDocument(source, cfg);
    expect(index.headings.at(-1)!.title).toBe("[Article 1] 셋째 조");
    expect(index.references.item).toBe("Article 1 / item 1");
    expect(index.figures[0].caption).toBe("설명 (Plate 1)");
    const web = renderDocument(source, {
      project: "p",
      path: "main.qmd",
      numbering: cfg,
    });
    expect(web.html).toContain("<figcaption>설명 (Plate 1)</figcaption>");
    expect(web.html).toContain('href="#item">Article 1 / item 1</a>');
  });
  it("resolves only explicit prefixes and keeps rich title content available to Typst", () => {
    const cfg = settings();
    cfg.headings.rules = [
      {
        ...defaultLevel("Article {n}"),
        match: "CH{n}",
        title: "{h1} / {label}: {title}",
      },
    ];
    const index = numberDocument(
      "# Chapter\n\n## CH9 **Title**\n\n## Unmatched\n",
      cfg,
    );
    expect(index.headings[1]).toMatchObject({
      prefix: "CH9 ",
      body: "**Title**",
      label: "Article 9",
      titlePattern: "{h1} / {label}: {title}",
    });
    expect(index.headings[2]).toMatchObject({
      prefix: "",
      body: "Unmatched",
      label: "제10조",
    });
    expect(index.references.constructor).toBeUndefined();
  });
});
