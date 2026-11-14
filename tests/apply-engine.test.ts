import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  sourceClauses,
  patchDocument,
  sections,
  schedulePlacement,
  bindTargets,
} from "../apps/apply/server/engine";
import { numberDocument } from "../packages/codec/src/document-numbering";
import { defaultNumbering } from "../packages/codec/src/numbering";
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
  it("refreshes decisions and timing from the sheet on every import without manual overrides", () => {
    const config: Connection = {
      ...connection,
      decisions: [
        { value: "Approve", action: "replace" },
        { value: "Retain", action: "keep" },
        { value: "Reject", action: "exclude" },
      ],
      timings: [
        { value: "This edition", year: "edition" },
        { value: "Later", year: null },
      ],
    };
    const row = [
      "key",
      "group",
      "See other",
      "",
      "current text",
      "",
      "Approve",
      "",
    ];
    let previous = sourceClauses([row], config, []);
    previous[0].draft = {
      ...previous[0].draft,
      fileId: randomUUID(),
      anchor: "target",
      final: "See \\ref{other}",
      replacements: [{ from: "other", to: "\\ref{other}" }],
    };
    const get = (decision: string, timing: string, text = "See other") => {
      const rows = [
        [...row.slice(0, 2), text, ...row.slice(3, 6), decision, timing],
      ];
      previous = sourceClauses(rows, config, previous);
      return previous[0].draft;
    };
    expect(get("Approve", "This edition")).toMatchObject({
      year: 2027,
      confirmed: true,
      action: "schedule",
      final: "See \\ref{other}",
    });
    expect(get("Approve", "Later")).toMatchObject({
      year: null,
      deferred: true,
      confirmed: true,
    });
    expect(get("Approve", "")).toMatchObject({
      year: null,
      deferred: false,
      confirmed: false,
    });
    expect(get("Approve", "Unknown")).toMatchObject({
      year: null,
      confirmed: false,
    });
    expect(get("Approve", "This edition", "Revised other").final).toBe(
      "Revised \\ref{other}",
    );
    expect(
      get("Approve", "This edition", "First\r\n• See other\\nlast").final,
    ).toBe("First\n- See \\ref{other}\nlast");
    expect(get("Retain", "This edition").final).toBe("current text");
    expect(get("Undecided", "This edition")).toMatchObject({
      action: "hold",
      confirmed: false,
      final: "See \\ref{other}",
    });
    expect(get("Reject", "")).toMatchObject({
      action: "schedule",
      deferred: true,
      confirmed: true,
    });
    expect(get("", "")).toMatchObject({
      action: "hold",
      year: null,
      confirmed: false,
      final: "See \\ref{other}",
    });
  });
  it("reads exactly through the highest configured column, including beyond AZ", () => {
    expect(sourceRange(connection)).toBe("'Source'!A3:H100");
    expect(
      sourceRange({
        ...connection,
        sheet: "Team's rules",
        columns: { ...connection.columns, notes: "BA" },
      }),
    ).toBe("'Team''s rules'!A3:BA100");
    // An empty last row reads to the end of the sheet, within the reader's 10000 rows.
    expect(sourceRange({ ...connection, lastRow: null })).toBe(
      "'Source'!A3:H10002",
    );
  });
  it("keeps a clause when its chapter or section title is renamed, unless its key repeats", () => {
    const rename = (rows: unknown[][]) =>
      rows.map((r) =>
        r[1] === "section" ? [r[0], "renamed", ...r.slice(2)] : r,
      );
    const first = sourceClauses(values, connection, []);
    first[0].draft.anchor = "scope";
    const renamed = sourceClauses(rename(values), connection, first);
    expect(renamed.map((c) => c.id)).toEqual(first.map((c) => c.id));
    expect(renamed[0]).toMatchObject({ context: ["renamed"] });
    expect(renamed[0].draft.anchor).toBe("scope");
    expect(renamed[0].sourceKey).not.toBe(first[0].sourceKey);
    // The same key in two sections cannot be told apart once a title changes.
    const twice = [...values, ["arbitrary-id", "other", "Again"]];
    const both = sourceClauses(twice, connection, []);
    const moved = sourceClauses(rename(twice), connection, both);
    expect(moved[0].id).not.toBe(both[0].id);
    expect(moved[2].id).toBe(both[2].id);
  });
  it("leads a heading row without a key into the next clause and leaves trailing tables out", () => {
    const rows = [
      ["a 1", "one", "First"],
      ["", "two", "Figure 2: caption", "", "", "", "", "이번 개정"],
      ["a 2", "", "Second", "", "", "", "새 문안", "이번 개정"],
      ["", "Table 1", "| x | y |"],
      ["", "", "| 1 | 2 |"],
    ];
    const clauses = sourceClauses(rows, connection, []);
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toMatchObject({
      source: "First",
      firstRow: 3,
      lastRow: 3,
    });
    expect(clauses[1]).toMatchObject({
      context: ["two"],
      source: "Figure 2: caption\n\nSecond",
      timing: "이번 개정",
      firstRow: 4,
      lastRow: 5,
    });
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
  it("names both clauses of a reference that sheet decisions would break, before and during comparison", () => {
    const fileId = randomUUID(),
      source =
        "# Chassis {#chassis}\n\n## Mounting {#mounting}\n\n### Clause {#mount}\n\nComponents withstand 40 g.\n\n![Mount](mount.png){#fig-mount}\n\n## Battery {#battery}\n\n### Clause {#tsac}\n\nTSAC withstands \\ref{mount}. See \\ref{fig-mount} and \\ref{mounting}.\n";
    const mount = clause();
    mount.key = "T 3.3.1";
    mount.draft = {
      ...mount.draft,
      action: "schedule",
      fileId,
      anchor: "mount",
      year: null,
      deferred: true,
      final: "Components withstand 40 g.",
    };
    const tsac = structuredClone(mount);
    tsac.id = randomUUID();
    tsac.key = "EV 5.5.8";
    tsac.draft = {
      ...tsac.draft,
      anchor: "tsac",
      deferred: false,
      confirmed: false,
      final: "TSAC withstands 40 g.",
    };
    const all = [mount, tsac],
      files = [{ id: fileId, source }];
    bindTargets(all, files, 2027);
    const pairs = [
      { from: "EV 5.5.8", to: "T 3.3.1" },
      { from: "EV 5.5.8", to: "T 3.3.1의 그림" },
      { from: "EV 5.5.8", to: "‘Mounting’" },
    ];
    expect(mount.brokenReferences).toEqual(pairs);
    expect(tsac.brokenReferences).toEqual(pairs);
    let detail = "";
    try {
      patchDocument(source, [mount], 2027, fileId, all);
    } catch (e: any) {
      expect(e.code).toBe("BROKEN_REFERENCE");
      detail = e.detail;
    }
    expect(detail).toBe(
      "EV 5.5.8에서 T 3.3.1 참조, EV 5.5.8에서 T 3.3.1의 그림 참조, EV 5.5.8에서 ‘Mounting’ 참조",
    );
    // Rewording the referring clause for the same edition resolves the conflict.
    tsac.draft.confirmed = true;
    tsac.draft.year = 2027;
    bindTargets(all, files, 2027);
    expect(mount.brokenReferences).toBeUndefined();
    expect(tsac.brokenReferences).toBeUndefined();
    expect(patchDocument(source, all, 2027, fileId, all)).toBe(
      "# Chassis {#chassis}\n\n## Battery {#battery}\n\n### Clause {#tsac}\n\nTSAC withstands 40 g.\n\n",
    );
  });
  it("links rule codes in sheet text to clauses and sections included in this edition", () => {
    const config: Connection = {
      ...connection,
      decisions: [{ value: "Approve", action: "replace" }],
      timings: [
        { value: "This edition", year: "edition" },
        { value: "Later", year: null },
      ],
    };
    const row = (
      key: string,
      context: string,
      text: string,
      timing: string,
    ) => [key, context, text, "", "", "", "Approve", timing];
    const rows = (later: string) => [
      row("T 3.2.1", "T 3.2 Materials", "Use steel.", "This edition"),
      row(
        "T 3.2.2",
        "T 3.2 Materials",
        "Bends keep T 3.2.1. See T 3.2 and T 3.2.15.",
        "This edition",
      ),
      row(
        "T 4.1.1",
        "T 4.1 Cockpit",
        "Seats meet T 3.2. Brakes follow T 5.1.1.",
        "This edition",
      ),
      row("T 5.1.1", "T 5.1 Brakes", "Brakes stop.", later),
    ];
    const fileId = randomUUID(),
      parents = {
        "T 3.2": { label: "materials", heading: "## Materials {#materials}" },
        "T 4.1": { label: "cockpit", heading: "## Cockpit {#cockpit}" },
        "T 5.1": { label: "brakes", heading: "## Brakes {#brakes}" },
      };
    let clauses = sourceClauses(rows("Later"), config, []);
    clauses.forEach((c, i) => {
      c.draft = {
        ...c.draft,
        fileId,
        anchor: `c${i + 1}`,
        placement: {
          heading: `### Clause {#c${i + 1}}`,
          parents: [parents[c.key.slice(0, 5) as keyof typeof parents]],
        },
      };
    });
    clauses = sourceClauses(rows("Later"), config, clauses);
    expect(clauses.map((c) => c.draft.final)).toEqual([
      "Use steel.",
      "Bends keep \\ref{c1}. See \\ref{materials} and T 3.2.15.",
      "Seats meet \\ref{materials}. Brakes follow T 5.1.1.",
      "Brakes stop.",
    ]);
    // Once the referenced clause joins this edition, its code links too.
    clauses = sourceClauses(rows("This edition"), config, clauses);
    expect(clauses[2].draft.final).toBe(
      "Seats meet \\ref{materials}. Brakes follow \\ref{c4}.",
    );
  });
  it("prints a clause introduced after this edition with its year after the lead paragraph", () => {
    const config: Connection = {
      ...connection,
      decisions: [{ value: "Approve", action: "replace" }],
      timings: [
        { value: "This edition", year: "edition" },
        { value: "Next year", year: 2028 },
        { value: "Undecided", year: null },
      ],
    };
    const rows = (timing: string) => [
      [
        "T 1.1.1",
        "T 1.1 Rules",
        "Wheels are round.",
        "",
        "",
        "",
        "Approve",
        "This edition",
      ],
      [
        "T 1.1.2",
        "T 1.1 Rules",
        "Tests include:\n\n- shake\n- tilt",
        "",
        "",
        "",
        "Approve",
        timing,
      ],
      [
        "T 1.1.3",
        "T 1.1 Rules",
        "- only a list",
        "",
        "",
        "",
        "Approve",
        timing,
      ],
    ];
    const fileId = randomUUID(),
      source =
        "# Rules {#rules}\n\n## Clause {#c1}\n\nWheels are round.\n\n## Clause {#c2}\n\nold tests\n\n";
    let clauses = sourceClauses(rows("Next year"), config, []);
    clauses.forEach((c, i) => {
      c.draft = { ...c.draft, fileId, anchor: `c${i + 1}` };
    });
    bindTargets(clauses, [{ id: fileId, source }], 2027);
    clauses[2].draft.placement = {
      heading: "## Clause {#c3}",
      parents: [{ label: "rules", heading: "# Rules {#rules}" }],
    };
    clauses = sourceClauses(rows("Next year"), config, clauses);
    expect(clauses.map((c) => c.draft.final)).toEqual([
      "Wheels are round.",
      "Tests include: (2028년 도입)\n\n- shake\n- tilt",
      "(2028년 도입)\n\n- only a list",
    ]);
    bindTargets(clauses, [{ id: fileId, source }], 2027);
    expect(patchDocument(source, clauses.slice(1), 2027, fileId, clauses)).toBe(
      "# Rules {#rules}\n\n## Clause {#c1}\n\nWheels are round.\n\n## Clause {#c2}\n\nTests include: (2028년 도입)\n\n- shake\n- tilt\n\n## Clause {#c3}\n\n(2028년 도입)\n\n- only a list\n\n",
    );
    // A timing without a year still keeps the clause out of the document.
    clauses = sourceClauses(rows("Undecided"), config, clauses);
    expect(clauses[1].draft).toMatchObject({
      deferred: true,
      final: "Tests include:\n\n- shake\n- tilt",
    });
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
  it("removes deferred headings and restores their position without placeholders", () => {
    const c = clause();
    c.draft.action = "schedule";
    const source =
      "# Chapter {#scope}\n\nold text\n\n# Other {#other}\n\nuntouched\n";
    c.draft.year = null;
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "CLAUSE_NOT_READY",
    );
    c.draft.deferred = true;
    c.draft.placement = schedulePlacement(source, c.draft.anchor);
    const deferred = patchDocument(source, [c], 2027, c.draft.fileId);
    expect(deferred).toBe("# Other {#other}\n\nuntouched\n");
    c.draft.before = "";
    c.draft.deferred = false;
    c.draft.year = 2027;
    const included = patchDocument(deferred, [c], 2027, c.draft.fileId);
    expect(included).toBe(source.replace("old text", "new text"));
    c.draft.year = 2026;
    expect(patchDocument(deferred, [c], 2027, c.draft.fileId)).toBe(included);
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "BEFORE_TEXT_CHANGED",
    );
    c.draft.before = "old text";
    expect(() =>
      patchDocument(
        source.replace("old text", "old text\n\nmanual addition"),
        [c],
        2027,
        c.draft.fileId,
      ),
    ).toThrow("BEFORE_TEXT_CHANGED");
    c.draft.anchor = "";
    expect(() => patchDocument(source, [c], 2027, c.draft.fileId)).toThrow(
      "ANCHOR_NOT_FOUND",
    );
  });
  it("prunes empty parents, renumbers only included clauses, and restores source order", () => {
    const source =
      "# First {#first}\n\n## Group {#group}\n\n### Clause {#scope}\n\nold text\n\n# Second {#second}\n\n## Other {#other}\n\n### Clause {#later}\n\nlater text\n";
    const a = clause();
    a.draft.action = "schedule";
    a.draft.final = "old text";
    a.draft.year = null;
    a.draft.deferred = true;
    a.draft.placement = schedulePlacement(source, "scope");
    const b = structuredClone(a);
    b.id = randomUUID();
    b.draft.anchor = "later";
    b.draft.before = "later text";
    b.draft.final = "later text";
    const deferred = patchDocument(source, [a], 2027, a.draft.fileId, [a, b]);
    expect(deferred.startsWith("# Second")).toBe(true);
    const settings = defaultNumbering();
    settings.headings.enabled = true;
    settings.headings.levels[2].format = "{1}.{2}.{3}";
    expect(numberDocument(deferred, settings).references.later).toBe("1.1.1");
    a.draft.before = "";
    a.draft.deferred = false;
    a.draft.year = 2027;
    expect(patchDocument(deferred, [a], 2027, a.draft.fileId, [a, b])).toBe(
      source,
    );
    expect(numberDocument(source, settings).references.later).toBe("2.1.1");
  });
  it("restores any combination of deferred clauses across shared and missing parents", () => {
    const fileId = randomUUID();
    let source = "Introduction\n\n";
    const clauses = Array.from({ length: 6 }, (_, i) => {
      if (i % 3 === 0)
        source += `# Chapter {#chapter-${Math.floor(i / 3)}}\n\n`;
      if (i % 3 !== 1) source += `## Group {#group-${i}}\n\n`;
      source += `### Clause {#item-${i}}\n\ntext ${i}\n\n`;
      const c = clause();
      c.id = randomUUID();
      c.draft = {
        ...c.draft,
        action: "schedule",
        fileId,
        anchor: `item-${i}`,
        before: `text ${i}`,
        final: `text ${i}`,
        year: null,
        deferred: true,
      };
      return c;
    });
    for (const c of clauses)
      c.draft.placement = schedulePlacement(source, c.draft.anchor);
    for (let mask = 1; mask < 64; mask++) {
      const selected = structuredClone(
        clauses.filter((_, i) => mask & (1 << i)),
      );
      const deferred = patchDocument(source, selected, 2027, fileId, clauses);
      expect(
        sections(deferred).filter((s) => s.label.startsWith("item-")),
      ).toHaveLength(6 - selected.length);
      for (const c of selected) {
        c.draft.before = "";
        c.draft.deferred = false;
        c.draft.year = 2027;
      }
      expect(
        patchDocument(deferred, selected.toReversed(), 2027, fileId, clauses),
      ).toBe(source);
    }
  });
});
