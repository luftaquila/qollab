import { randomUUID } from "node:crypto";
import {
  ApplyError,
  columnIndex,
  digest,
  draftSchema,
  changeDigest,
  type Clause,
  type Connection,
  type Draft,
} from "./model.js";
const text = (v: unknown) => (v == null ? "" : String(v).trim());
/** Row positions are provenance, not identity. Continuation rows belong to their key. */
export function sourceClauses(
  values: unknown[][],
  c: Connection,
  old: Clause[],
): Clause[] {
  const groups: any[] = [];
  const context = c.columns.context.map(() => "");
  const get = (row: unknown[], col?: string) =>
    col ? text(row[columnIndex(col)]) : "";
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    c.columns.context.forEach((col, j) => {
      if (get(row, col)) context[j] = get(row, col);
    });
    const key = get(row, c.columns.key);
    if (key)
      groups.push({
        key,
        context: [...context],
        source: [],
        current: [],
        notes: [],
        decision: [],
        timing: [],
        firstRow: c.firstRow + i,
        lastRow: c.firstRow + i,
      });
    const g = groups.at(-1);
    if (!g) continue;
    g.lastRow = c.firstRow + i;
    for (const field of ["source", "current"] as const)
      for (const col of c.columns[field])
        if (get(row, col)) g[field].push(get(row, col));
    for (const field of ["notes", "decision", "timing"] as const)
      if (get(row, c.columns[field])) g[field].push(get(row, c.columns[field]));
  }
  const seen = new Set<string>();
  return groups.map((g) => {
    const sourceKey = digest([c.spreadsheetId, c.sheet, g.context, g.key]);
    if (seen.has(sourceKey))
      throw new ApplyError("DUPLICATE_SOURCE_KEY", 409, g.key);
    seen.add(sourceKey);
    const fields = {
      key: g.key,
      context: g.context,
      source: g.source.join("\n\n"),
      current: g.current.join("\n\n"),
      notes: [...new Set(g.notes)].join("\n\n"),
      decision: [...new Set(g.decision)].join(" / "),
      timing: [...new Set(g.timing)].join(" / "),
    };
    const sourceHash = digest(fields);
    const previous = old.find((o) => o.sourceKey === sourceKey);
    const draft: Draft = previous
      ? { ...previous.draft }
      : {
          year: c.timings.find((t) => t.value === fields.timing)?.year ?? null,
          action:
            c.decisions.find((d) => d.value === fields.decision)?.action ??
            "hold",
          fileId: "",
          anchor: "",
          before: fields.current,
          final: "",
          confirmed: false,
        };
    if (previous && previous.sourceHash !== sourceHash) draft.confirmed = false;
    return {
      ...previous,
      ...fields,
      id: previous?.id || randomUUID(),
      sourceKey,
      sourceHash,
      approvalHash:
        previous?.sourceHash === sourceHash
          ? previous.approvalHash
          : sourceHash,
      firstRow: g.firstRow,
      lastRow: g.lastRow,
      missing: false,
      draft,
    };
  });
}
export function reviewRows(rows: unknown[][]) {
  const records = new Map<string, { row: number; values: unknown[] }>();
  for (let i = 1; i < rows.length; i++) {
    const id = text(rows[i][0]);
    if (!id) continue;
    if (records.has(id)) throw new ApplyError("DUPLICATE_REVIEW_ID", 409, id);
    records.set(id, { row: i + 1, values: rows[i] });
  }
  return records;
}
export function withReview(c: Clause, row?: unknown[]): Clause {
  if (!row) return c;
  const year = text(row[7]);
  const checked = row[9] === true || text(row[9]).toUpperCase() === "TRUE";
  const parsed = draftSchema.safeParse({
    year: year ? Number(year) : null,
    final: String(row[8] ?? ""),
    confirmed: checked,
    fileId: text(row[10]),
    anchor: text(row[11]),
    action: text(row[12]),
    before: String(row[13] ?? ""),
  });
  if (!parsed.success) throw new ApplyError("INVALID_REVIEW_ROW", 409, c.key);
  return { ...c, draft: parsed.data, approvalHash: text(row[14]) };
}
export interface Section {
  label: string;
  title: string;
  start: number;
  end: number;
  body: string;
}
/** Existing Markdown heading labels define scopes; visible numbers never identify edits. */
export function sections(source: string): Section[] {
  const headings: {
    label: string;
    title: string;
    level: number;
    start: number;
  }[] = [];
  let offset = 0,
    fence = "";
  for (const line of source.split(/(?<=\n)/)) {
    const code = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (code) {
      if (!fence) fence = code[1];
      else if (code[1][0] === fence[0] && code[1].length >= fence.length)
        fence = "";
      offset += line.length;
      continue;
    }
    if (!fence) {
      const m = /^(#{1,6})\s+(.+?)(?:\s+\{#([a-zA-Z][\w:-]*)\})?\s*$/.exec(
        line.trimEnd(),
      );
      if (m)
        headings.push({
          level: m[1].length,
          title: m[2],
          label: m[3] || "",
          start: offset,
        });
    }
    offset += line.length;
  }
  const labels = new Set<string>();
  return headings.flatMap((h, i) => {
    if (!h.label) return [];
    if (labels.has(h.label))
      throw new ApplyError("DUPLICATE_DOCUMENT_LABEL", 409, h.label);
    labels.add(h.label);
    const end =
      headings.slice(i + 1).find((n) => n.level <= h.level)?.start ??
      source.length;
    return [{ ...h, end, body: source.slice(h.start, end) }];
  });
}
export function patchDocument(
  source: string,
  clauses: Clause[],
  year: number,
  fileId: string,
) {
  const scopes = sections(source);
  const edits: { start: number; end: number; value: string; key: string }[] =
    [];
  for (const c of clauses) {
    const d = c.draft;
    if (
      c.missing ||
      !d.confirmed ||
      d.year !== year ||
      c.approvalHash !== c.sourceHash
    )
      throw new ApplyError("CLAUSE_NOT_READY", 409, c.key);
    if (c.appliedHash === changeDigest(c))
      throw new ApplyError("ALREADY_APPLIED", 409, c.key);
    if (
      d.fileId !== fileId ||
      !["insert", "replace", "keep"].includes(d.action)
    )
      throw new ApplyError("TARGET_REQUIRED", 409, c.key);
    if (d.action === "keep") continue;
    if (!d.final.trim())
      throw new ApplyError("FINAL_TEXT_REQUIRED", 409, c.key);
    const scope = d.anchor
      ? scopes.find((s) => s.label === d.anchor)
      : undefined;
    if (d.anchor && !scope)
      throw new ApplyError("ANCHOR_NOT_FOUND", 409, c.key);
    if (d.action === "insert") {
      const at = scope?.end ?? source.length;
      edits.push({
        start: at,
        end: at,
        value: "\n\n" + d.final.trim() + "\n\n",
        key: c.key,
      });
    } else {
      if (!d.before.trim())
        throw new ApplyError("BEFORE_TEXT_REQUIRED", 409, c.key);
      const start = scope?.start ?? 0,
        end = scope?.end ?? source.length,
        body = source.slice(start, end);
      const at = body.indexOf(d.before);
      if (at < 0 || body.indexOf(d.before, at + 1) >= 0)
        throw new ApplyError("BEFORE_TEXT_CHANGED", 409, c.key);
      edits.push({
        start: start + at,
        end: start + at + d.before.length,
        value: d.final,
        key: c.key,
      });
    }
  }
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < edits.length; i++)
    if (edits[i].start < edits[i - 1].end)
      throw new ApplyError("OVERLAPPING_CHANGES", 409, edits[i].key);
  let result = "",
    offset = 0;
  for (const edit of edits) {
    result += source.slice(offset, edit.start) + edit.value;
    offset = edit.end;
  }
  result += source.slice(offset);
  // Reject duplicate labels and broken explicit references introduced by this batch.
  const labels = (s: string) =>
    [...s.matchAll(/(?:\{#|\\label\{)([a-zA-Z][\w:-]*)\}/g)].map((m) => m[1]);
  const oldLabels = labels(source),
    newLabels = labels(result),
    known = new Set(newLabels);
  for (const label of known)
    if (
      newLabels.filter((l) => l === label).length >
      Math.max(1, oldLabels.filter((l) => l === label).length)
    )
      throw new ApplyError("DUPLICATE_DOCUMENT_LABEL", 409, label);
  const broken = (s: string, ids: Set<string>) =>
    new Set(
      [...s.matchAll(/\\ref\{([\w:-]+)\}|\]\(#([\w:-]+)\)/g)]
        .map((m) => m[1] || m[2])
        .filter((l) => !ids.has(l)),
    );
  const previous = broken(source, new Set(oldLabels));
  for (const ref of broken(result, known))
    if (!previous.has(ref)) throw new ApplyError("BROKEN_REFERENCE", 409, ref);
  return result;
}
