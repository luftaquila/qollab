import { describe, it, expect } from "vitest";
import { preparePdf } from "../apps/web/src/pdf-source";
import {
  defaultNumbering,
  defaultLevel,
} from "../packages/codec/src/numbering";
const bytes = (s: string) => new TextEncoder().encode(s);
describe("PDF source preservation", () => {
  const source =
    "---\nlang: ko\nformat:\n  typst:\n    template-partials: [../style/typst-template.typ, ../style/typst-show.typ]\n---\n\n# EV 2 Original\n\n1. First\n";
  const template =
    '#let enum-labels = ("①", "1.", "가.", "a.")\n#let rules(body) = body';
  const files = {
    "rules/main.qmd": bytes(source),
    "style/typst-template.typ": bytes(template),
    "style/typst-show.typ": bytes("#show: rules"),
  };
  it("uses the project template unchanged by default, including original list styles", () => {
    const result = preparePdf(files, "rules/main.qmd");
    expect(result.inputs["typst-template.typ"]).toBe(template);
    expect(result.inputs["typst-show.typ"]).toBe("#show: rules");
    expect(result.body).toContain("# EV 2 Original");
    expect(result.options.filters).toHaveLength(2);
    expect(new TextDecoder().decode(files["rules/main.qmd"])).toBe(source);
  });
  it("resolves enabled numbering separately without rewriting source or templates", () => {
    const settings = defaultNumbering();
    settings.headings.enabled = true;
    settings.headings.rules.push({
      ...defaultLevel("전기 {n}조"),
      match: "EV {n}",
    });
    settings.lists.enabled = true;
    settings.lists.levels = [{ ...defaultLevel("{n}항"), style: "korean" }];
    const result = preparePdf(files, "rules/main.qmd", settings);
    expect(result.body).toContain("# EV 2 Original");
    expect(result.inputs["typst-template.typ"]).toBe(template);
    const resolved = JSON.parse(
      new TextDecoder().decode(
        result.assets[".qollab/document-numbering.json"],
      ),
    );
    expect(resolved.headings[0].title).toBe("전기 2조 Original");
    expect(resolved.settings.lists.levels[0].format).toBe("{n}항");
    expect(new TextDecoder().decode(files["style/typst-template.typ"])).toBe(
      template,
    );
  });
  it("fails explicitly when a requested template is missing", () => {
    expect(() =>
      preparePdf({ "rules/main.qmd": bytes(source) }, "rules/main.qmd"),
    ).toThrow("Missing template partial");
  });
  it("keeps literal heading syntax inside code and Typst blocks when changing displayed numbers", () => {
    const source =
      "# EV 2 Heading\n\n```markdown\n# EV 2 Example\n```\n\n```{=typst}\n# EV 2 Raw\n```\n";
    const result = preparePdf({ "main.qmd": bytes(source) }, "main.qmd", {
      ...defaultNumbering(),
      headings: {
        ...defaultNumbering().headings,
        enabled: true,
        rules: [{ ...defaultLevel("전기 {n}조"), match: "EV {n}" }],
      },
    });
    expect(result.body).toBe(source);
    const resolved = JSON.parse(
      new TextDecoder().decode(
        result.assets[".qollab/document-numbering.json"],
      ),
    );
    expect(resolved.headings.map((h: any) => h.title)).toEqual([
      "전기 2조 Heading",
    ]);
    expect(result.body).toContain("# EV 2 Example");
    expect(result.body).toContain("# EV 2 Raw");
  });
});
