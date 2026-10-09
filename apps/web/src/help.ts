import { pick } from "./i18n";
/**
 * How a snippet goes into the visual editor: parsed Markdown as blocks or
 * inline content, or a source block for syntax the visual editor keeps raw.
 */
export type InsertKind = "block" | "inline" | "raw" | "none";
export interface HelpEntry {
  /** Sample text; a pair gives Korean and English placeholders. */
  syntax: string | [string, string];
  text: [string, string];
  insert: InsertKind;
}
export interface HelpSection {
  id: string;
  title: [string, string];
  note?: [string, string];
  entries: HelpEntry[];
}
export { pick };
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const alt = mod === "⌘" ? "⌥" : "Alt";

export const helpSections: HelpSection[] = [
  {
    id: "markdown",
    title: ["기본 Markdown", "Markdown basics"],
    note: [
      "문단은 빈 줄로 나눕니다. 편집기에서 줄 맨 앞에 #, -, 1., > 를 입력하면 바로 해당 서식이 됩니다.",
      "Separate paragraphs with a blank line. Typing #, -, 1. or > at the start of a line applies the format.",
    ],
    entries: [
      { syntax: ["# 제목 1\n## 제목 2\n### 제목 3", "# Heading 1\n## Heading 2\n### Heading 3"], text: ["제목. #의 개수가 수준입니다.", "Headings; the number of # is the level."], insert: "block" },
      { syntax: ["**굵게** *기울임* ~~취소선~~", "**bold** *italic* ~~strikethrough~~"], text: ["글자 서식", "Bold, italic, strikethrough"], insert: "inline" },
      { syntax: ["`인라인 코드`", "`inline code`"], text: ["코드처럼 고정폭 글자로 표시", "Monospaced inline code"], insert: "inline" },
      { syntax: ["[링크 글자](https://quarto.org)", "[link text](https://quarto.org)"], text: ["링크", "Link"], insert: "inline" },
      { syntax: ["- 항목\n- 항목\n  - 하위 항목", "- item\n- item\n  - nested item"], text: ["글머리 목록. 두 칸 들여쓰면 하위 목록", "Bullet list; indent two spaces to nest"], insert: "block" },
      { syntax: ["1. 첫째\n2. 둘째", "1. first\n2. second"], text: ["번호 목록", "Numbered list"], insert: "block" },
      { syntax: ["- [ ] 할 일\n- [x] 끝난 일", "- [ ] to do\n- [x] done"], text: ["체크 목록", "Task list"], insert: "block" },
      { syntax: ["> 인용문", "> quotation"], text: ["인용", "Quote"], insert: "block" },
      { syntax: ["| 열 1 | 열 2 |\n|------|------|\n| 값   | 값   |", "| Col 1 | Col 2 |\n|-------|-------|\n| value | value |"], text: ["표", "Table"], insert: "block" },
      { syntax: "```python\nprint(\"hello\")\n```", text: ["코드 블록. 언어 이름을 붙일 수 있습니다(실행은 하지 않음).", "Code block with an optional language (not executed)."], insert: "block" },
      { syntax: "***", text: ["구분선. 문서 맨 앞의 ---는 YAML 머리말이므로 본문에서는 ***를 권장합니다.", "Horizontal rule. --- at the very top is YAML front matter, so prefer *** in text."], insert: "block" },
      { syntax: ["줄 끝에 백슬래시\\\n다음 줄", "backslash at line end\\\nnext line"], text: ["문단 안에서 줄바꿈", "Line break inside a paragraph"], insert: "none" },
    ],
  },
  {
    id: "math",
    title: ["수식", "Math"],
    note: [
      "LaTeX 수식 문법으로 쓰면 PDF에서는 Typst 수식으로 바뀝니다. 편집기의 수식 블록(Σ)에서 미리보기를 볼 수 있습니다.",
      "Write LaTeX math; the PDF typesets it with Typst. The math block (Σ) in the editor shows a preview.",
    ],
    entries: [
      { syntax: "$x^2 + y^2 = z^2$", text: ["문장 안의 수식", "Inline math"], insert: "inline" },
      { syntax: "$$\nE = mc^2\n$$", text: ["따로 선 수식", "Display math"], insert: "block" },
      { syntax: "$$\nE = mc^2\n$$ {#eq-energy}", text: ["번호가 붙는 수식. [@eq-energy]로 참조", "Numbered equation; reference with [@eq-energy]"], insert: "raw" },
      { syntax: "\\frac{a}{b}  \\sqrt{x}  x_{i}^{2}", text: ["분수, 제곱근, 첨자", "Fraction, root, sub/superscript"], insert: "none" },
      { syntax: "\\sum_{i=1}^{n}  \\int_{0}^{1}  \\lim_{x \\to 0}", text: ["합, 적분, 극한", "Sum, integral, limit"], insert: "none" },
      { syntax: "\\alpha \\beta \\pi \\theta \\infty \\leq \\neq \\approx", text: ["그리스 문자와 기호", "Greek letters and symbols"], insert: "none" },
    ],
  },
  {
    id: "quarto",
    title: ["Quarto 기능", "Quarto features"],
    note: [
      "라벨과 참조는 본문에서 우클릭해 붙이고 넣을 수도 있습니다. sec-·fig-·tbl-·eq- 라벨은 PDF에서 번호로 바뀝니다.",
      "You can also add labels and references with a right-click. sec-, fig-, tbl- and eq- labels become numbers in the PDF.",
    ],
    entries: [
      { syntax: ["# 서론 {#sec-intro}", "# Introduction {#sec-intro}"], text: ["제목에 라벨", "Label a heading"], insert: "block" },
      { syntax: "[@sec-intro]", text: ["번호가 붙는 참조(예: 절 1, 그림 2)", "Numbered reference (e.g. Section 1)"], insert: "inline" },
      { syntax: ["[문항 3]{#q3}", "[Question 3]{#q3}"], text: ["단어·문장·문항에 라벨", "Label any words"], insert: "inline" },
      { syntax: ["[문항 3으로](#q3)", "[to Question 3](#q3)"], text: ["라벨 위치로 가는 링크", "Link to a label"], insert: "inline" },
      { syntax: ["![캡션](assets/images/그림.png){#fig-chart width=60%}", "![Caption](assets/images/figure.png){#fig-chart width=60%}"], text: ["그림. 툴바의 이미지 버튼으로 넣고 그림 속성에서 라벨·너비를 정하는 편이 쉽습니다.", "Figure. Easier with the image button and figure properties."], insert: "none" },
      { syntax: ["| 열 | 값 |\n|----|----|\n| a  | 1  |\n\n: 표 캡션 {#tbl-result}", "| Col | Value |\n|-----|-------|\n| a   | 1     |\n\n: Table caption {#tbl-result}"], text: ["캡션과 라벨이 있는 표", "Table with caption and label"], insert: "raw" },
      { syntax: ["본문 내용^[각주 내용]", "Body text^[Footnote text]"], text: ["각주", "Footnote"], insert: "raw" },
      { syntax: ["::: {.callout-note}\n알아둘 내용\n:::", "::: {.callout-note}\nSomething to note\n:::"], text: ["강조 상자(note, tip, warning, important, caution)", "Callout (note, tip, warning, important, caution)"], insert: "raw" },
      { syntax: [":::: {.columns}\n::: {.column width=\"50%\"}\n왼쪽\n:::\n::: {.column width=\"50%\"}\n오른쪽\n:::\n::::", ":::: {.columns}\n::: {.column width=\"50%\"}\nLeft\n:::\n::: {.column width=\"50%\"}\nRight\n:::\n::::"], text: ["2단 배치", "Two columns"], insert: "raw" },
      { syntax: ["[밑줄 글자]{.underline}", "[underlined text]{.underline}"], text: ["밑줄. 도구 모음의 밑줄 버튼이나 단축키로도 넣습니다.", "Underline; also from the toolbar or its shortcut."], insert: "inline" },
      { syntax: "[@kim2024]", text: ["문헌 인용. 문서 설정의 YAML에 bibliography: refs.bib가 필요합니다.", "Citation; needs bibliography: refs.bib in the YAML."], insert: "inline" },
    ],
  },
  {
    id: "typst",
    title: ["Typst 조판", "Typst layout"],
    note: [
      "PDF는 Typst로 만듭니다. 쪽 나눔·글자 색·밑줄·참조는 아래 LaTeX 명령을 그대로 써도 Typst로 바뀝니다. 그 밖의 조판은 Typst 블록(```{=typst})이나 `…`{=typst}로 씁니다. 문서 전체에 적용할 설정은 문서 설정 → 고급 → Typst 머리말에 넣으세요.",
      "PDFs are made with Typst. The LaTeX commands below for page breaks, text colour, underline and references still work; they are translated to Typst. Write other layout as a Typst block (```{=typst}) or `…`{=typst}. Put settings for the whole document under Document settings → Advanced → Typst preamble.",
    ],
    entries: [
      { syntax: "\\newpage", text: ["다음 내용을 새 페이지에서 시작", "Start the next content on a new page"], insert: "block" },
      { syntax: ["\\textcolor{red}{빨간 글자} \\textcolor[HTML]{1C7667}{청록 글자}", "\\textcolor{red}{red text} \\textcolor[HTML]{1C7667}{teal text}"], text: ["글자 색. 도구 모음의 글자 색 버튼으로도 바꿉니다. 색 이름(red, blue, teal…)이나 16진수 색 코드를 씁니다.", "Text color; also from the toolbar's text color button. Use a color name (red, blue, teal…) or a hex code."], insert: "inline" },
      { syntax: ["항목 \\label{item-a} … \\ref{item-a}", "item \\label{item-a} … \\ref{item-a}"], text: ["목록 항목에 라벨을 붙이고 번호로 참조", "Label a list item and refer to its number"], insert: "none" },
      { syntax: "```{=typst}\n#v(1cm)\n```", text: ["세로 간격 넣기", "Vertical space"], insert: "raw" },
      { syntax: "`#h(2em)`{=typst}", text: ["가로 간격 넣기", "Horizontal space"], insert: "inline" },
      { syntax: "`#h(1fr)`{=typst}", text: ["줄의 남은 공간을 채움(뒤 글자를 오른쪽 끝으로)", "Fill the rest of the line (push text right)"], insert: "inline" },
      { syntax: ["```{=typst}\n#align(center)[가운데 정렬할 내용]\n```", "```{=typst}\n#align(center)[centered content]\n```"], text: ["가운데 정렬", "Centered block"], insert: "raw" },
      { syntax: ["```{=typst}\n#align(right)[오른쪽 정렬할 내용]\n```", "```{=typst}\n#align(right)[right-aligned content]\n```"], text: ["오른쪽 정렬", "Right-aligned block"], insert: "raw" },
      { syntax: ["`#text(size: 14pt)[큰 글자]`{=typst}", "`#text(size: 14pt)[large text]`{=typst}"], text: ["글자 크기", "Text size"], insert: "inline" },
      { syntax: "```{=typst}\n#set page(numbering: none)\n```", text: ["이 자리부터 쪽 번호 숨기기", "Hide page numbers from here on"], insert: "raw" },
      { syntax: "```{=typst}\n#counter(page).update(1)\n```", text: ["쪽 번호를 1부터 다시 시작", "Restart page numbering at 1"], insert: "raw" },
      { syntax: "```{=typst}\n#set page(numbering: \"i\")\n```", text: ["쪽 번호를 로마 숫자로(\"1\"로 되돌림)", "Roman page numbers (\"1\" to switch back)"], insert: "raw" },
    ],
  },
  {
    id: "keys",
    title: ["단축키", "Shortcuts"],
    entries: [
      { syntax: `${mod}+B / ${mod}+I / ${mod}+E`, text: ["굵게 / 기울임 / 인라인 코드", "Bold / italic / inline code"], insert: "none" },
      { syntax: `${mod}+U / ${mod}+${alt}+X`, text: ["밑줄 / 취소선", "Underline / strikethrough"], insert: "none" },
      { syntax: `${mod}+Z / ${mod}+Shift+Z`, text: ["실행 취소 / 다시 실행(내 편집만)", "Undo / redo (your own edits)"], insert: "none" },
      { syntax: "/", text: ["빈 줄에서 블록 메뉴 열기", "Block menu on an empty line"], insert: "none" },
      { syntax: `${mod}+S`, text: ["Markdown 편집 중 바로 저장(자동 저장도 됨)", "Save while editing Markdown (also autosaves)"], insert: "none" },
      { syntax: ["우클릭 / Shift+우클릭", "Right-click / Shift+right-click"], text: ["편집 메뉴 / 브라우저 기본 메뉴", "Editor menu / browser menu"], insert: "none" },
    ],
  },
];
