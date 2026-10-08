import { beforeAll, describe, expect, it } from "vitest";
import { initCodec, getRuntime } from "../apps/server/src/codec.js";
import { decode } from "../packages/codec/src/index.js";
import { anchorAt, locate, normalize, sourceAnchor, type TextIndex } from "../apps/web/src/pdf-sync.js";
beforeAll(initCodec);
/** A PDF text index from lines of [page, top, text]. */
function pdfText(lines: [number, number, string][]): TextIndex {
  let text = "";
  const owner: number[] = [];
  const boxes = lines.map(([page, top, line], i) => {
    const n = normalize(line);
    text += n;
    owner.push(...Array(n.length).fill(i));
    return { page, top, bottom: top + 12 };
  });
  return { text, owner: Int32Array.from(owner), boxes };
}
describe("editor to PDF sync", () => {
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
  it("finds the copy of repeated text between the right neighbours", () => {
    const index = pdfText([
      [1, 100, "① 장갑"],
      [1, 120, "공식 인증된 용품을 사용해야 한다."],
      [2, 100, "② 신발"],
      [2, 120, "공식 인증된 용품을 사용해야 한다."],
      [2, 140, "• SFI Spec 3.3"],
    ]);
    const anchor = {
      runs: [normalize("공식 인증된 용품을 사용해야 한다.")],
      run: 0,
      offset: 4,
      before: [normalize("신발")],
      after: [normalize("SFI Spec 3.3")],
      order: 0.1,
      ratio: 0.5,
    };
    expect(locate(index, anchor)).toMatchObject({ page: 2, top: 120 });
    // A short block is found through its neighbours too.
    expect(locate(index, { ...anchor, runs: ["신발"], offset: 0, before: [], after: [normalize("공식 인증된")] })).toMatchObject({ page: 2, top: 100 });
    expect(locate(index, { ...anchor, runs: ["없는문장입니다"], before: [], after: [] })).toBeNull();
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
