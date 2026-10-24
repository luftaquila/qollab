import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  pdfCacheKey,
  verifyPdfAssets,
  type PdfSnapshot,
} from "../apps/web/src/pdf-cache";
import { defaultNumbering } from "../packages/codec/src/numbering";

const snapshot = (): PdfSnapshot => ({
  project: "project",
  target: "main.qmd",
  overrides: {
    "main.qmd": "# Current draft\n",
    "template.typ": "#set text(size: 10pt)",
  },
  assets: { "image.png": "sha256:first" },
  numbering: defaultNumbering(),
});
describe("browser PDF cache inputs", () => {
  it("reuses equal inputs despite object ordering or unrelated project metadata", () => {
    const before = snapshot();
    const after = {
      ...before,
      revision: 50,
      peers: ["Another editor"],
      overrides: Object.fromEntries(Object.entries(before.overrides).reverse()),
      numbering: Object.fromEntries(
        Object.entries(before.numbering!).reverse(),
      ) as typeof before.numbering,
    };
    expect(pdfCacheKey(after)).toBe(pdfCacheKey(before));
  });
  it("invalidates for current draft, templates, numbering, image content and document identity", () => {
    const before = snapshot();
    const mutations: ((s: PdfSnapshot) => void)[] = [
      (s) => {
        s.overrides["main.qmd"] += "Unsaved edit\n";
      },
      (s) => {
        s.overrides["template.typ"] = "#set text(size: 12pt)";
      },
      (s) => {
        s.numbering!.headings.levels[0].format = "Article {n}";
      },
      (s) => {
        s.assets["image.png"] = "sha256:replacement";
      },
      (s) => {
        delete s.assets["image.png"];
      },
      (s) => {
        s.target = "other.qmd";
      },
      (s) => {
        s.project = "other-project";
      },
    ];
    for (const mutate of mutations) {
      const after = structuredClone(before);
      mutate(after);
      expect(pdfCacheKey(after)).not.toBe(pdfCacheKey(before));
    }
  });
  it("does not cache an export whose image was replaced after the input snapshot", async () => {
    const bytes = new TextEncoder().encode("image bytes");
    const identity = createHash("sha256").update(bytes).digest("hex");
    expect(
      await verifyPdfAssets({ "image.png": bytes }, { "image.png": identity }),
    ).toBe(true);
    expect(
      await verifyPdfAssets(
        { "image.png": new TextEncoder().encode("replacement") },
        { "image.png": identity },
      ),
    ).toBe(false);
    expect(await verifyPdfAssets({}, { "image.png": identity })).toBe(false);
    expect(
      await verifyPdfAssets({ "image.png": bytes }, { "image.png": "" }),
    ).toBe(false);
  });
});
