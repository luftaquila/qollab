import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  sourceClauses,
  patchDocument,
  sections,
} from "../apps/apply/server/engine";
import {
  changeDigest,
  sourceRange,
  type Connection,
  type Clause,
} from "../apps/apply/server/model";
const connection: Connection = {
  spreadsheetId: "test-spreadsheet",
  sheet: "Source",
  firstRow: 3,
  lastRow: 100,
  year: 2027,
  columns: {
    key: "A",
    context: ["B"],
    source: ["C", "D"],
    current: ["E"],
    notes: "F",
    decision: "G",
    timing: "H",
  },
  decisions: [{ value: "새 문안", action: "insert" }],
  timings: [{ value: "이번 개정", year: 2027 }],
};
const values = [
  [
    "arbitrary-id",
    "section",
    "Definition",
    "- first",
    "Existing",
    "note",
    "새 문안",
    "이번 개정",
  ],
  ["", "", "", "- second"],
  ["next", "", "Another"],
];
function clause(): Clause {
  const c = sourceClauses(values, connection, [])[0];
  c.draft = {
    year: 2027,
    action: "replace",
    fileId: randomUUID(),
    anchor: "scope",
    before: "old text",
    final: "new text",
    confirmed: true,
  };
  return c;
}
describe("sheet-driven document changes", () => {
  it("reads exactly through the highest configured column, including beyond AZ", () => {
    expect(sourceRange(connection)).toBe("'Source'!A3:H100");
    expect(
      sourceRange({
        ...connection,
        sheet: "Team's rules",
        columns: { ...connection.columns, notes: "BA" },
      }),
    ).toBe("'Team''s rules'!A3:BA100");
  });
  it("groups continuation rows and preserves identity when rows move", () => {
    const first = sourceClauses(values, connection, []);
    expect(first[0].source).toBe("Definition\n\n- first\n\n- second");
    expect(first[0]).toMatchObject({ firstRow: 3, lastRow: 4 });
    expect(first[0].draft).toMatchObject({
      action: "insert",
      year: 2027,
      confirmed: false,
    });
    const moved = sourceClauses([[""], ...values], connection, first);
    expect(moved[0].id).toBe(first[0].id);
    expect(moved[0].firstRow).toBe(4);
    expect(moved[0].sourceHash).toBe(first[0].sourceHash);
    const next = sourceClauses(
      [["arbitrary-id", "section", "changed"]],
      connection,
      first,
    );
    expect(next[0].draft.confirmed).toBe(false);
    expect(() => sourceClauses([values[0], values[0]], connection, [])).toThrow(
      "DUPLICATE_SOURCE_KEY",
    );
  });
  it("preserves unselected text, raw Typst, images and numbering in exact replacements", () => {
    const before =
      "---\nformat: typst\n---\n\n```{=typst}\n#custom[untouched]\n```\n\n# Chapter {#scope}\n\nold text\n\n![Figure](image.png){#fig-one}\n\n# Other {#other}\n\nold text\n";
    const c = clause();
    const after = patchDocument(before, [c], 2027, c.draft.fileId);
    expect(after).toBe(before.replace("old text", "new text"));
    expect(sections(before).map((s) => s.label)).toEqual(["scope", "other"]);
    c.draft.before = "  indented\n";
    c.draft.final = "  replacement\n";
    expect(
      patchDocument(
        "# Chapter {#scope}\n  indented\n",
        [c],
        2027,
        c.draft.fileId,
      ),
    ).toBe("# Chapter {#scope}\n  replacement\n");
  });
  it("requires explicit confirmation and current source, year and unique old text", () => {
    const c = clause(),
      source = "# Chapter {#scope}\nold text\n";
    c.draft.confirmed = false;
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "CLAUSE_NOT_READY",
    );
    c.draft.confirmed = true;
    expect(() => patchDocument(source, [c], 2028, c.draft.fileId)).toThrow(
      "CLAUSE_NOT_READY",
    );
    c.approvalHash = "stale";
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "CLAUSE_NOT_READY",
    );
    c.approvalHash = c.sourceHash;
    expect(() =>
      patchDocument(source + "old text", [c], 2027, c.draft.fileId),
    ).toThrow("BEFORE_TEXT_CHANGED");
    c.appliedHash = changeDigest(c);
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "ALREADY_APPLIED",
    );
  });
  it("blocks overlapping changes and newly broken or duplicated explicit references", () => {
    const c = clause(),
      source = "# Chapter {#scope}\nold text\n\n\\ref{scope}\n";
    expect(() =>
      patchDocument(
        source,
        [c, { ...c, id: randomUUID() }],
        2027,
        c.draft.fileId,
      ),
    ).toThrow("OVERLAPPING_CHANGES");
    c.draft.final = "\\ref{missing}";
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "BROKEN_REFERENCE",
    );
    c.draft.final = "## Another {#scope}";
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "DUPLICATE_DOCUMENT_LABEL",
    );
  });
  it("inserts a selected group in order and leaves future or held proposals out", () => {
    const c = clause();
    c.draft.action = "insert";
    c.draft.final = "first";
    const d = structuredClone(c);
    d.id = randomUUID();
    d.draft.final = "second";
    const source = "# Chapter {#scope}\nold text\n\n# Other {#other}\n";
    const after = patchDocument(source, [c, d], 2027, c.draft.fileId);
    expect(after.indexOf("first")).toBeLessThan(after.indexOf("second"));
    expect(after.indexOf("second")).toBeLessThan(after.indexOf("# Other"));
    d.draft.action = "hold";
    expect(() => patchDocument(source, [d], 2027, d.draft.fileId)).toThrow(
      "TARGET_REQUIRED",
    );
  });
});
