import { beforeAll, describe, expect, it } from "vitest";
import { initCodec, getRuntime } from "../apps/server/src/codec.js";
import { decode } from "../packages/codec/src/index.js";
import { anchorAt, normalize, readSource, sourceAnchor, syncLine } from "../apps/web/src/editor-sync.js";
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
    const source = readSource(lines);
    const anchor = sourceAnchor(source, 6, lines[6].indexOf("켜져야"), 0.2)!;
    expect(anchor.runs).toEqual(["제동등은", "에따라켜져야한다."]);
    expect([anchor.run, anchor.offset]).toEqual([1, 3]);
    expect(anchor.before).toEqual(["제동장치"]);
    expect(anchor.after).toEqual(["표"]);
    expect(sourceAnchor(source, 1, 0, 0.5)).toBeNull();
  });
  it("reads the cursor's place in a fenced line as LaTeX too", () => {
    const table = readSource(["```{=latex}", "메인 \\& 전방 & 25mm \\\\", "```", "", "다음 문단"]);
    const cell = sourceAnchor(table, 1, table.lines[1].indexOf("mm"), 0.2)!;
    expect(cell.runs).toEqual(["메인&전방", "25mm"]);
    expect([cell.run, cell.offset]).toEqual([1, 2]);
    expect(cell.after).toEqual(["다음문단"]);
  });
  it("reads a table row as its cells and takes no place from punctuation alone", () => {
    const source = readSource(["| 사용 위치 | 원형 |", "|:---|---:|", "| 1번 부재 | 25mm × 1.2mm |", "", ")", "다음 문단"]);
    expect(source.runs.slice(0, 5)).toEqual([["사용위치", "원형"], [], ["1번부재", "25mm×1.2mm"], [], []]);
    const cell = sourceAnchor(source, 2, source.lines[2].indexOf("1.2"), 0.5)!;
    expect([cell.run, cell.offset]).toEqual([1, 5]);
    expect(cell.before).toEqual(["원형"]);
    expect(cell.after).toEqual(["다음문단"]);
  });
  it("lets a block that opens with a chip stand for its first text of some length", () => {
    const d = decode("1. \\ref{lights}에 따라 제동등이 켜져야 한다.\n\n2. 가 \\ref{lights} 다음 항목이다.\n", getRuntime());
    const starts: number[] = [];
    d.doc.descendants((node, pos) => {
      if (node.isTextblock) starts.push(pos);
    });
    const first = anchorAt(d.doc, starts[0], 0.1)!;
    expect(first.runs[first.run]).toBe("에따라제동등이켜져야한다.");
    expect(first.offset).toBe(0);
    const second = anchorAt(d.doc, starts[1], 0.1)!;
    expect(second.runs).toEqual(["가", "다음항목이다."]);
    expect(second.run).toBe(1);
  });
  it("matches the cursor's height while it is well on screen, else the nearest such height", () => {
    expect(syncLine(0.4)).toBe(0.4);
    expect(syncLine(-2)).toBe(0.05);
    expect(syncLine(1.5)).toBe(0.9);
    expect(syncLine(undefined)).toBe(0.3);
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
