import { beforeAll, describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  prosemirrorToYDoc,
  yXmlFragmentToProseMirrorRootNode,
} from "y-prosemirror";
import {
  initCodec,
  initialize,
  updateDocument,
  getRuntime,
} from "../apps/server/src/codec.js";
import { decode, encode } from "../packages/codec/src/index.js";
import { renderPolicy } from "../packages/codec/src/render-policy.js";
import { readZip } from "../apps/server/src/archive.js";
import { zipSync } from "fflate";
import { imageWidth } from "../packages/codec/src/image.js";
beforeAll(initCodec);
it("exports resized figure width and preserves other Quarto attributes", () => {
  const rt = getRuntime(),
    source =
      '![Caption](assets/a.png){#fig-demo fig-alt="alt" width="80%" fig-align="right"}\n';
  const d = decode(source, rt),
    json = d.doc.toJSON();
  json.content[0].attrs.width = "35%";
  const output = encode(rt.schema.nodeFromJSON(json), d.preservation, rt);
  expect(output).toContain('width="35%"');
  expect(output).toContain('fig-align="right"');
  expect(output).toContain('fig-alt="alt"');
  const reopened = decode(output, rt);
  expect(reopened.doc.firstChild!.attrs.width).toBe("35%");
  expect(encode(reopened.doc, reopened.preservation, rt)).toBe(output);
  json.content[0].attrs.width = "80%";
  json.content[0].attrs.ratio = 0.5;
  expect(encode(rt.schema.nodeFromJSON(json), d.preservation, rt)).toContain(
    'width="40%"',
  );
  expect(imageWidth({ width: "4in", ratio: 0.5 })).toBe("2in");
});
describe("labels and references", () => {
  const source =
    "---\ntitle: x\n---\n\n# 서론 {#sec-intro}\n\n[@sec-intro]를 보세요. @fig-chart 와 [문항 3]{#q3} 정답.\n\n[문항 3으로](#q3) 이동.\n";
  it("edits labelled headings, spans and references visually", () => {
    const rt = getRuntime(),
      d = decode(source, rt);
    expect(d.safe).toBe(true);
    const types = d.doc.toJSON().content.map((n: any) => n.type);
    expect(types).toEqual(["qollab_raw", "heading", "paragraph", "paragraph"]);
    expect(d.doc.child(1).attrs.label).toBe("sec-intro");
    const inline = d.doc.child(2).toJSON().content;
    expect(inline[0]).toMatchObject({
      type: "qollab_ref",
      attrs: { key: "sec-intro", bracketed: true },
    });
    expect(inline[2]).toMatchObject({
      type: "qollab_ref",
      attrs: { key: "fig-chart", bracketed: false },
    });
    expect(inline[4]).toMatchObject({
      text: "문항 3",
      marks: [{ type: "qollab_label", attrs: { id: "q3" } }],
    });
    expect(encode(d.doc, d.preservation, rt)).toBe(source);
  });
  it("writes edited labels back as Quarto syntax", () => {
    const rt = getRuntime(),
      d = decode(source, rt),
      json = d.doc.toJSON();
    json.content[1].attrs.label = "sec-start";
    json.content[2].content[1].text = "을 보세요. ";
    json.content[2].content[4].marks[0].attrs.id = "q4";
    const output = encode(rt.schema.nodeFromJSON(json), d.preservation, rt);
    expect(output).toBe(
      "---\ntitle: x\n---\n\n# 서론 {#sec-start}\n\n[@sec-intro]을 보세요. @fig-chart 와 [문항 3]{#q4} 정답.\n\n[문항 3으로](#q3) 이동.\n",
    );
    expect(decode(output, rt).safe).toBe(true);
  });
  it.each([
    "인용 [@a; @b] 목록.",
    "위치 [@a, p. 3] 참조.",
    "[**굵은 구간**]{#q5}",
    "[구간]{.class}",
  ])("keeps unsupported syntax raw: %s", (block) => {
    const d = decode(block + "\n", getRuntime());
    expect(d.doc.firstChild!.type.name).toBe("qollab_raw");
  });
});
it("keeps a blank line after edited YAML front matter", () => {
  const rt = getRuntime(),
    source = '---\ntitle: "Draft"\n# keep\n---\n\n# Introduction\n\nText.\n',
    d = decode(source, rt),
    json = d.doc.toJSON();
  json.content[0].content[0].text = '---\ntitle: "Report"\n# keep\n---';
  const output = encode(rt.schema.nodeFromJSON(json), d.preservation, rt);
  expect(output).toBe(
    '---\ntitle: "Report"\n# keep\n---\n\n# Introduction\n\nText.\n',
  );
  expect(encode(d.doc, d.preservation, rt)).toBe(source);
});
it("does not write empty figure placeholders into Quarto source", () => {
  const rt = getRuntime(),
    source = "---\ntitle: x\n---\n\n# Heading\n\nText.\n",
    d = decode(source, rt),
    json = d.doc.toJSON();
  json.content.push({ type: "image-block", attrs: { src: "" } });
  const output = encode(rt.schema.nodeFromJSON(json), d.preservation, rt);
  expect(output).not.toContain("![");
  expect(output.startsWith("---\ntitle: x\n---")).toBe(true);
  const reopened = decode(output, rt);
  expect(reopened.safe).toBe(true);
  expect(reopened.doc.childCount).toBe(3);
});
const fixture =
  '---\n# Preserve this comment\ntitle: "한글 문서"\nformat: pdf\n---\n\n# Heading  {#sec-head}\n\nA **bold** paragraph.\n\n::: {.callout-note}\n\nOuter\n\n::: {.inner}\n\nNested [@citation] and @fig-demo.\n\n:::\n\n:::\n\n![Caption](assets/a.png){#fig-demo fig-alt="image" width=80%}\n\n```{python}\n#| echo: false\nprint(1)\n```\n\n\\begin{equation}\nx=2\n\\end{equation}\n';
describe("source preservation", () => {
  it("preserves YAML, unsupported inline syntax, nested div, cells, TeX and image attrs byte-for-byte", () => {
    const rt = getRuntime(),
      d = decode(fixture, rt);
    expect(d.safe).toBe(true);
    expect(encode(d.doc, d.preservation, rt)).toBe(fixture);
  });
  it("changes only one visual block and stabilizes repeated saves", () => {
    const rt = getRuntime(),
      d = decode(fixture, rt);
    const json = d.doc.toJSON();
    const p = json.content.find((n: any) => n.type === "paragraph");
    p.content[0].text = "An edited ";
    const edited = rt.schema.nodeFromJSON(json);
    const output = encode(edited, d.preservation, rt);
    expect(output).toContain("# Preserve this comment");
    expect(output).toContain("::: {.inner}");
    expect(output).toContain("#| echo: false");
    expect(output).toContain("An edited **bold** paragraph.");
    const second = decode(output, rt);
    expect(encode(second.doc, second.preservation, rt)).toBe(output);
  });
  it.each(["---\ntitle: broken", "```{r}\n1", "::: {.outer}\ntext"])(
    "blocks uncertain boundaries %s",
    (source) => expect(initialize(source).mode).toBe("raw"),
  );
  it("merges character changes in raw nodes and recovers durable state", () => {
    const base = initialize(fixture);
    const a = new Y.Doc(),
      b = new Y.Doc();
    Y.applyUpdate(a, Buffer.from(base.state, "base64"));
    Y.applyUpdate(b, Buffer.from(base.state, "base64"));
    const changes: Uint8Array[] = [];
    a.on("update", (u) => changes.push(u));
    b.on("update", (u) => changes.push(u));
    const ra = (a.getXmlFragment("prosemirror").get(0) as Y.XmlElement).get(
        0,
      ) as Y.XmlText,
      rb = (b.getXmlFragment("prosemirror").get(0) as Y.XmlElement).get(
        0,
      ) as Y.XmlText;
    ra.insert(4, "# Alice\n");
    rb.insert(4, "# Bob\n");
    let state = base.state,
      source = "";
    for (const u of changes) {
      const result = updateDocument(state, u, base.preservation);
      state = result.state;
      source = result.source;
    }
    expect(source).toContain("# Alice");
    expect(source).toContain("# Bob");
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Buffer.from(state, "base64"));
    expect(
      encode(
        yXmlFragmentToProseMirrorRootNode(
          restored.getXmlFragment("prosemirror"),
          getRuntime().schema,
        ),
        base.preservation,
        getRuntime(),
      ),
    ).toBe(source);
    a.destroy();
    b.destroy();
    restored.destroy();
  });
});
describe("render and archive boundaries", () => {
  it.each([
    "filters: [evil.lua]",
    "pre-render: evil.sh",
    "format:\n  pdf:\n    pdf-engine-opts: [-shell-escape]",
    "execute: true",
    "template: /etc/passwd",
  ])("rejects %s", (source) =>
    expect(() => renderPolicy([{ path: "_quarto.yml", source }])).toThrow(),
  );
  it("accepts static Korean math tables and images", () =>
    expect(() =>
      renderPolicy([
        {
          path: "report.qmd",
          source:
            "---\ntitle: 한글\nformat: pdf\n---\n\n$$x^2$$\n\n![이미지](assets/a.png)",
        },
      ]),
    ).not.toThrow());
  it("accepts the Typst options the settings panel and projects write", () =>
    expect(() =>
      renderPolicy([
        {
          path: "_quarto.yml",
          source: [
            "papersize: us-letter",
            "margin:",
            "  top: 20mm",
            "  x: 25mm",
            "columns: 2",
            "page-numbering: false",
            "header-includes: '#set par(first-line-indent: 1em)'",
            "format:",
            "  typst:",
            "    template-partials:",
            "      - template/typst-template.typ",
            "      - template/typst-show.typ",
          ].join("\n"),
        },
        { path: "report.qmd", source: "---\nformat: typst\n---\n\n본문" },
      ]),
    ).not.toThrow());
  it.each(["../x.typ", "/etc/x.typ", "template/x.tex", ".qollab/typst-show.typ", "a/../b.typ", "C:/x.typ"])(
    "rejects the template partial %s",
    (partial) =>
      expect(() =>
        renderPolicy([
          { path: "_quarto.yml", source: `format:\n  typst:\n    template-partials: ["${partial}"]` },
        ]),
      ).toThrow("Template partials must be .typ files in the project"),
  );
  it("accepts every option the document settings panel writes", () =>
    expect(() =>
      renderPolicy([
        {
          path: "_quarto.yml",
          source: [
            "papersize: a4",
            "geometry: [top=25mm, bottom=25mm, left=30mm, right=25mm]",
            "mainfont: Latin Modern Roman",
            "CJKmainfont: UnBatang",
            "sansfont: DejaVu Sans",
            "monofont: Noto Sans Mono CJK KR",
            "fontsize: 11pt",
            "linestretch: 1.5",
            "indent: true",
            "documentclass: report",
            "classoption: [twocolumn]",
            "pagestyle: plain",
            "number-sections: true",
            "number-depth: 2",
            "toc: true",
            "toc-depth: 2",
            "toc-title: 목차",
            "lof: true",
            "colorlinks: true",
            "linkcolor: teal",
            "fig-cap-location: bottom",
            "tbl-cap-location: top",
            "crossref:",
            "  fig-title: 그림",
            "  tbl-title: 표",
            "  fig-prefix: 그림",
            "  tbl-prefix: 표",
            "  eq-prefix: 식",
            "  sec-prefix: 절",
            "date: today",
            "date-format: long",
            "urlcolor: blue",
            "boxlinks: true",
            "pdf-engine: lualatex",
            "header-includes: |",
            "  \\usepackage{titlesec}",
          ].join("\n"),
        },
      ]),
    ).not.toThrow());
  it.each([
    "mainfont: Comic Sans MS",
    "CJKmainfont: Nanum Gothic",
    "pdf-engine: pdflatex",
    "format:\n  pdf:\n    pdf-engine: tectonic",
  ])(
    "rejects %s",
    (source) =>
      expect(() => renderPolicy([{ path: "_quarto.yml", source }])).toThrow(),
  );
  it.each(["scrreprt", "scrbook", "book"])("accepts document class %s", (documentclass) =>
    expect(() =>
      renderPolicy([{ path: "_quarto.yml", source: `documentclass: ${documentclass}\nmainfont: Pretendard` }]),
    ).not.toThrow(),
  );
  it("rejects executing cells", () =>
    expect(() =>
      renderPolicy([{ path: "r.qmd", source: "```{python}\nprint(1)\n```" }]),
    ).toThrow());
  it.each([
    "../escape.qmd",
    "/tmp/x.qmd",
    ".git/config",
    "_extensions/evil.lua",
    "assets/a.svg",
  ])("rejects ZIP path %s", (path) =>
    expect(() =>
      readZip(Buffer.from(zipSync({ [path]: Buffer.from("x") }))),
    ).toThrow(),
  );
  it("accepts LaTeX templates and packages in a ZIP", () =>
    expect(
      Object.keys(
        readZip(
          Buffer.from(
            zipSync({
              "report.qmd": Buffer.from("# x\n"),
              "template.tex": Buffer.from("\\usepackage{tikz}\n"),
              "unicode-math.sty": Buffer.from("\\ProvidesPackage{unicode-math}\n"),
            }),
          ),
        ),
      ).sort(),
    ).toEqual(["report.qmd", "template.tex", "unicode-math.sty"]));
  it("rejects a symlink in the ZIP central directory", () => {
    const zip = Buffer.from(zipSync({ "a.qmd": Buffer.from("/etc/passwd") }));
    const at = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE((0xa1ff << 16) >>> 0, at + 38);
    expect(() => readZip(zip)).toThrow();
  });
});
it("keeps source identity for identical paragraphs with different Markdown spelling", () => {
  const rt = getRuntime(),
    source = "**same**\n\n__same__\n",
    d = decode(source, rt),
    json = d.doc.toJSON();
  json.content.shift();
  const out = encode(rt.schema.nodeFromJSON(json), d.preservation, rt);
  expect(out).toContain("__same__");
  expect(out).not.toContain("**same**");
});
describe("text color and underline", () => {
  it("edits Quarto underline and LaTeX colors visually and writes them back", () => {
    const rt = getRuntime(),
      source =
        "수정 [밑줄 글자]{.underline} 와 **\\textcolor{red}{빨강 50\\%}** 그리고 \\textcolor[HTML]{1C7667}{청록 \\ul{밑줄}}.\n",
      d = decode(source, rt);
    expect(d.doc.firstChild!.type.name).toBe("paragraph");
    const marks = d.doc.firstChild!.toJSON().content.map((n: any) =>
      (n.marks || []).map((m: any) => m.attrs?.color ?? m.type).join("+"),
    );
    expect(marks).toEqual(["", "qollab_underline", "", "strong+red", "", "#1C7667", "#1C7667+qollab_underline", ""]);
    expect(encode(d.doc, d.preservation, rt)).toBe(source);
  });
  it("round trips nested formatting and characters special to Markdown or LaTeX", () => {
    const rt = getRuntime(),
      s = rt.schema,
      text = (value: string, ...marks: any[]) => s.text(value, marks),
      red = s.marks.qollab_color.create({ color: "red" }),
      teal = s.marks.qollab_color.create({ color: "#1C7667" }),
      underline = s.marks.qollab_underline.create();
    const doc = s.node("doc", null, [
      s.node("paragraph", null, [
        text("앞 "),
        text("빨강 밑줄", red, underline),
        text(" 빨강 ", red),
        text("굵은 빨강", s.marks.strong.create(), red),
        text(" "),
        text("특수 *별* [괄호] {중괄호} \\역 50% $5 a_b #1 & ~ ^ `틱` <a>", teal),
        text(" "),
        text("밑줄", underline),
      ]),
    ]);
    const output = encode(doc, decode("", rt).preservation, rt);
    expect(output).toContain("\\textcolor{red}{\\ul{빨강 밑줄} 빨강 \\textbf{굵은 빨강}}");
    const back = decode(output, rt);
    expect(back.doc.firstChild!.content.eq(doc.firstChild!.content)).toBe(true);
  });
});
describe("LaTeX commands, display math and figures in lists", () => {
  const fresh = (source: string) => {
    const rt = getRuntime(),
      d = decode(source, rt);
    return { d, out: encode(d.doc, decode("", rt).preservation, rt) };
  };
  it("keeps references, labels and commands in text as chips written back unchanged", () => {
    const source =
      "상용 볼트는 \\ref{wheels:torque}을, 그림은 \\cref{fig-a} 참고 \\label{note:a}.\\smallpar\n";
    const { d, out } = fresh(source);
    const chips: string[] = [];
    d.doc.descendants((n) => {
      if (n.type.name === "qollab_tex") chips.push(n.attrs.source);
    });
    expect(chips).toEqual(["\\ref{wheels:torque}", "\\cref{fig-a}", "\\label{note:a}", "\\smallpar"]);
    expect(out).toBe(source.trimEnd());
  });
  it("keeps a hard break before a chip", () => {
    const { out } = fresh("벌크헤드 (Bulkhead)\\\n\\label{bulkhead}\n벌크헤드란 앞부분이다.\n");
    expect(out).toBe("벌크헤드 (Bulkhead)\\\n\\label{bulkhead}\n벌크헤드란 앞부분이다.");
  });
  it("leaves commands that take text alone", () => {
    const { d } = fresh("\\textbf{굵게} \\emph{기울임}\n");
    let chips = 0;
    d.doc.descendants((n) => void (n.type.name === "qollab_tex" && chips++));
    expect(chips).toBe(0);
  });
  it("writes display math inside a paragraph back with double dollars", () => {
    const { out } = fresh("회전수는 다음과 같다. $$\\frac{a}{b}\;\\mathrm{rpm}$$\n");
    expect(out).toBe("회전수는 다음과 같다. $$\\frac{a}{b}\;\\mathrm{rpm}$$");
  });
  it("drops the space LaTeX ignores after \\textcolor's color", () => {
    const { out } = fresh("1. \\textcolor{blue}{ 파란 항목}\n\n   1. 하위 항목\n");
    expect(out).toBe("1. \\textcolor{blue}{파란 항목}\n\n   1. 하위 항목");
  });
  it("edits figures inside list items visually", () => {
    const source =
      "1. 항목 설명\n\n   ![연료 호스](assets/hose.jpg){#fig-hose width=40%}\n\n2. 다음 항목\n";
    const { d, out } = fresh(source);
    expect(d.doc.firstChild!.type.name).toBe("ordered_list");
    let figure: any;
    d.doc.descendants((n) => void (n.type.name === "image-block" && (figure = n.attrs)));
    expect(figure).toMatchObject({ src: "assets/hose.jpg", caption: "연료 호스", identifier: "fig-hose", width: "40%" });
    expect(out).toContain('![연료 호스](assets/hose.jpg){#fig-hose width="40%"}');
    // Written back, the list decodes to the same document.
    expect(decode(out, getRuntime()).doc.eq(d.doc)).toBe(true);
  });
  it("keeps a list raw when its figure has attributes the editor does not know", () => {
    const d = decode("1. 항목\n\n   ![그림](a.png){#fig-a fig-pos=\"H\"}\n", getRuntime());
    expect(d.doc.firstChild!.type.name).toBe("qollab_raw");
  });
  it("edits a list visually around a raw LaTeX block in an item", () => {
    const table = "```{=latex}\n\\begin{tblr}{hlines}\n  가 & 나 \\\\\n\n  다 & 라 \\\\\n\\end{tblr}\n```";
    const nested = table.split("\n").map((l) => (l ? "      " + l : l)).join("\n");
    const source = `1. 재료\n\n   1. 증빙자료를 제출한다.\n\n${nested}\n\n   * 나머지 프레임\n\n2. 대체 재료\n`;
    const { d, out } = fresh(source);
    expect(d.doc.childCount).toBe(1);
    expect(d.doc.firstChild!.type.name).toBe("ordered_list");
    const raws: string[] = [];
    d.doc.descendants((n) => void (n.type.name === "qollab_raw" && raws.push(n.textContent)));
    expect(raws).toEqual([table]);
    expect(out).toBe(source.trimEnd());
    // Copied text holds the block as written, not a code fence around it.
    const rt = getRuntime();
    expect(rt.serialize(rt.schema.node("doc", null, [rt.schema.nodes.qollab_raw.create(null, rt.schema.text(table))]))).toBe(table + "\n");
  });
  it("keeps a list raw when its LaTeX block is not indented with spaces", () => {
    const d = decode("1. 항목\n\n\t```{=latex}\n\t\\relax\n\t```\n", getRuntime());
    expect(d.doc.firstChild!.type.name).toBe("qollab_raw");
  });
  it("reads references and labels inside a text color", () => {
    const source = "\\textcolor{blue}{셀은 \\ref{loads}의 조건에서 80\\% 이상 고정한다.} \\label{cells}\n";
    const { d, out } = fresh(source);
    const marks: string[] = [];
    d.doc.descendants((n) => {
      if (n.type.name === "qollab_tex") marks.push(n.attrs.source + ":" + n.marks.map((m) => m.attrs.color).join());
    });
    expect(marks).toEqual(["\\ref{loads}:blue", "\\label{cells}:"]);
    expect(out).toBe(source.trimEnd());
  });
  it("keeps text raw when Markdown escapes sit inside a LaTeX argument", () => {
    const rt = getRuntime();
    // Visual text would hold `50%`, which LaTeX reads as a comment.
    expect(decode("효율은 \\textbf{50\\%} 이상이다.\n", rt).doc.firstChild!.type.name).toBe("qollab_raw");
    expect(decode("효율은 50\\% 이상이다. \\textbf{굵게}\n", rt).doc.firstChild!.type.name).toBe("qollab_raw");
    // Escapes alone, colors and math stay visual.
    for (const source of ["효율은 50\\% \\[참고\\] 이상이다.\n", "\\textcolor{red}{50\\%} 이상\n", "$\\frac{a}{b}\\,dx$ 와 \\[E\\]\n"])
      expect(decode(source, rt).doc.firstChild!.type.name).toBe("paragraph");
  });
});
