import { beforeAll, describe, expect, it } from "vitest";
import { initCodec, getRuntime } from "../apps/server/src/codec.js";
import { decode } from "../packages/codec/src/index.js";
import { anchorAt, normalize, sourceAnchor } from "../apps/web/src/editor-sync.js";
beforeAll(initCodec);
describe("editor preview anchors", () => {
  it("compares text without spaces, dashes and quote styles", () => {
    expect(normalize("Brake – System’s  pro-\ncess …")).toBe("brakesystem'sprocess...");
  });
  it("describes the text at the cursor without chips", () => {
    const d = decode("# 제동장치\n\n1. 제동등은 \\ref{lights}에 따라 켜져야 한다.\n\n2. 다음 항목\n", getRuntime());
    let pos = -1;
    d.doc.descendants((node, p) => {
      if (pos < 0 && node.isText && node.text!.includes("켜져야")) pos = p + node.text!.indexOf("켜져야");
    });
    const anchor = anchorAt(d.doc, pos, 0.4)!;
    expect(anchor.runs).toEqual(["제동등은", "에따라켜져야한다."]);
    expect([anchor.run, anchor.offset]).toEqual([1, 3]);
    expect(anchor.before).toEqual(["제동장치"]);
    expect(anchor.after).toEqual(["다음항목"]);
    expect(anchor.ratio).toBe(0.4);
  });
  it("reads a Markdown source line as the text it prints", () => {
    const lines = ["---", "title: 규정", "---", "", "## 제동장치 {#brakes}", "", "1. [제동등]{#light}은 \\ref{lights}에 따라 켜져야 한다.\\smallpar", "", "```{=latex}", "\\textbf{표} & 값 \\\\", "```"];
    const anchor = sourceAnchor(lines, 6, lines[6].indexOf("켜져야"), 0.2)!;
    expect(anchor.runs).toEqual(["제동등은", "에따라켜져야한다."]);
    expect([anchor.run, anchor.offset]).toEqual([1, 3]);
    expect(anchor.before).toEqual(["제동장치"]);
    expect(anchor.after).toEqual(["표"]);
    expect(sourceAnchor(lines, 1, 0, 0.5)).toBeNull();
  });
  it("reads the printed text of a LaTeX table row", () => {
    const table = "```{=latex}\n\\begin{tblr}{hlines}\n  메인 롤 후프 \\& 전방 롤 후프 & 25mm \\\\\n\\end{tblr}\n```";
    const d = decode(table + "\n", getRuntime());
    const raw = d.doc.firstChild!;
    const anchor = anchorAt(d.doc, 1 + raw.textContent.indexOf("전방"), 0.5)!;
    expect(anchor.runs).toEqual(["메인롤후프&전방롤후프", "25mm"]);
    expect(anchor.run).toBe(0);
  });
});
