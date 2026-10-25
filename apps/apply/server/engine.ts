import {
  ApplyError,
  columnIndex,
  digest,
  changeDigest,
  type Clause,
  type Connection,
  type Draft,
} from "./model.js";
const text = (v: unknown) => (v == null ? "" : String(v).trim());
function rewriteLiterals(
  source: string,
  replacements: Draft["replacements"] = [],
) {
  if (!replacements.length) return source;
  const values = new Map(replacements.map((r) => [r.from, r.to]));
  const pattern = [...values.keys()]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return source.replace(
    new RegExp(pattern, "g"),
    (match: string, offset: number) => {
      const before = source[offset - 1] || "",
        after = source[offset + match.length] || "";
      if (
        (/\w/.test(match[0]) && /[\w.]/.test(before)) ||
        (/\w/.test(match.at(-1)!) && /[\w.]/.test(after))
      )
        return match;
      return values.get(match)!;
    },
  );
}
/** Reading a proposed clause does not require a decision to introduce it. */
export function proposalText(
  fields: Pick<Clause, "source" | "current" | "decision">,
  connection: Connection,
  replacements?: Draft["replacements"],
) {
  const action = connection.decisions.find(
    (d) => d.value === fields.decision,
  )?.action;
  const material = action === "keep" ? fields.current : fields.source;
  return rewriteLiterals(
    material
      .replace(/\\r\\n|\\n/g, "\n")
      .replace(/\r\n?/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/^[▪•]\s*/gm, "- ")
      .trim(),
    replacements,
  );
}
// UUID v8 derived from source identity survives a lost first-import response.
const sourceId = (sourceKey: string) => {
  const h = digest(sourceKey);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
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
          year: null,
          action: "hold",
          fileId: "",
          anchor: "",
          before: fields.current,
          final: "",
          confirmed: false,
        };
    const decision = c.decisions.find(
      (d) => d.value === fields.decision,
    )?.action;
    const timing = c.timings.find((t) => t.value === fields.timing);
    const approved = !!decision && decision !== "hold";
    draft.year = timing?.year === "edition" ? c.year : (timing?.year ?? null);
    draft.deferred = decision === "exclude" || timing?.year === null;
    draft.action =
      approved && draft.anchor
        ? "schedule"
        : decision === "exclude"
          ? "hold"
          : decision || "hold";
    draft.final = proposalText(fields, c, draft.replacements);
    draft.confirmed =
      approved &&
      (!!timing || decision === "exclude") &&
      !!draft.fileId &&
      !!draft.anchor &&
      (!!draft.final || !!draft.deferred);
    return {
      ...previous,
      ...fields,
      id: previous?.id || sourceId(sourceKey),
      sourceKey,
      sourceHash,
      approvalHash: sourceHash,
      firstRow: g.firstRow,
      lastRow: g.lastRow,
      missing: false,
      draft,
    };
  });
}
export interface Section {
  label: string;
  title: string;
  start: number;
  end: number;
  body: string;
}
/** A proposal stays in review storage when its introduction is after this edition. */
export const scheduledText = (draft: Draft, year: number) =>
  !draft.deferred && draft.year !== null && draft.year <= year
    ? draft.final.trim()
    : "";
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
export function schedulePlacement(
  source: string,
  anchor: string,
): Draft["placement"] {
  const scopes = sections(source),
    scope = scopes.find((s) => s.label === anchor);
  if (!scope) return undefined;
  const heading = (s: Section) => s.body.split("\n")[0];
  return {
    heading: heading(scope),
    parents: scopes
      .filter((s) => s.start < scope.start && s.end >= scope.end)
      .map((s) => ({ label: s.label, heading: heading(s) })),
    next: scopes.find((s) => s.start >= scope.end)?.label,
    previous: scopes.filter((s) => s.end <= scope.start).at(-1)?.label,
  };
}
/** Capture the current clause for a comparison, never ask an operator to select raw text. */
export function bindTargets(
  clauses: Clause[],
  files: { id: string; source?: string }[],
  year: number,
) {
  const scopes = new Map(
    files
      .filter((f) => f.source !== undefined)
      .map((f) => [f.id, sections(f.source!)]),
  );
  for (const c of clauses) {
    c.matches = false;
    const d = c.draft,
      file = files.find((f) => f.id === d.fileId);
    if (file?.source === undefined) {
      d.confirmed = false;
      continue;
    }
    const scope = scopes.get(d.fileId)?.find((s) => s.label === d.anchor);
    if (!scope && !d.placement) {
      d.confirmed = false;
      continue;
    }
    d.before = scope
      ? scope.body.slice(scope.body.indexOf("\n") + 1).trim()
      : "";
    d.placement ||= schedulePlacement(file.source, d.anchor);
    const wanted = scheduledText(d, year);
    c.matches =
      d.confirmed && (wanted ? !!scope && d.before === wanted : !scope);
  }
  return clauses;
}
function scheduleClause(
  source: string,
  clause: Clause,
  year: number,
  all: Clause[],
) {
  const d = clause.draft,
    scopes = sections(source),
    scope = scopes.find((s) => s.label === d.anchor);
  if (!d.anchor) throw new ApplyError("ANCHOR_NOT_FOUND", 409, clause.key);
  const wanted = scheduledText(d, year);
  if (scope) {
    const headerEnd = scope.body.indexOf("\n") + 1;
    if (!headerEnd || scope.body.slice(headerEnd).trim() !== d.before.trim())
      throw new ApplyError("BEFORE_TEXT_CHANGED", 409, clause.key);
    if (wanted)
      return (
        source.slice(0, scope.start + headerEnd) +
        "\n" +
        wanted +
        "\n\n" +
        source.slice(scope.end)
      );
    let result = source.slice(0, scope.start) + source.slice(scope.end);
    // Empty parents must not keep consuming display numbers after their last clause is deferred.
    for (const parent of schedulePlacement(
      source,
      d.anchor,
    )!.parents.toReversed()) {
      const remaining = sections(result).find((s) => s.label === parent.label);
      if (
        remaining &&
        !remaining.body.slice(remaining.body.indexOf("\n") + 1).trim()
      )
        result = result.slice(0, remaining.start) + result.slice(remaining.end);
    }
    return result;
  }
  if (d.before.trim())
    throw new ApplyError("BEFORE_TEXT_CHANGED", 409, clause.key);
  if (!wanted) return source;
  const placement = d.placement;
  if (!placement || sections(placement.heading + "\n\n")[0]?.label !== d.anchor)
    throw new ApplyError("ANCHOR_NOT_FOUND", 409, clause.key);
  for (const parent of placement.parents)
    if (sections(parent.heading + "\n\n")[0]?.label !== parent.label)
      throw new ApplyError("ANCHOR_NOT_FOUND", 409, clause.key);
  const at = all.findIndex((c) => c.id === clause.id);
  const following =
    all
      .slice(at + 1)
      .filter((c) => c.draft.fileId === d.fileId)
      .map((c) => scopes.find((s) => s.label === c.draft.anchor))
      .find(Boolean) || scopes.find((s) => s.label === placement.next);
  const parents = placement.parents,
    existingParent = parents
      .map((p) => scopes.find((s) => s.label === p.label))
      .filter(Boolean)
      .at(-1);
  let offset = source.length;
  if (following) {
    const path = [
      ...scopes.filter(
        (s) => s.start < following.start && s.end >= following.end,
      ),
      following,
    ];
    offset = (
      path.find((s) => !parents.some((p) => p.label === s.label)) || following
    ).start;
  } else if (existingParent) offset = existingParent.end;
  else {
    const previous = scopes.find((s) => s.label === placement.previous);
    if (previous) offset = previous.end;
  }
  const prefix = parents
    .filter((p) => !scopes.some((s) => s.label === p.label))
    .map((p) => p.heading + "\n\n")
    .join("");
  return (
    source.slice(0, offset) +
    prefix +
    placement.heading +
    "\n\n" +
    wanted +
    "\n\n" +
    source.slice(offset)
  );
}
export function patchDocument(
  source: string,
  clauses: Clause[],
  year: number,
  fileId: string,
  allClauses: Clause[] = clauses,
  validate = true,
) {
  if (
    clauses.length > 1 &&
    clauses.some((c) => c.draft.action === "schedule")
  ) {
    let result = source;
    const ordered = [...clauses].sort(
      (a, b) =>
        allClauses.findIndex((c) => c.id === a.id) -
        allClauses.findIndex((c) => c.id === b.id),
    );
    for (const c of ordered)
      result = patchDocument(result, [c], year, fileId, allClauses, false);
    return validate ? validatePatched(source, result) : result;
  }
  const scopes = sections(source);
  const edits: { start: number; end: number; value: string; key: string }[] =
    [];
  for (const c of clauses) {
    const d = c.draft;
    if (
      c.missing ||
      !d.confirmed ||
      (d.action === "schedule"
        ? d.year === null && !d.deferred
        : d.year !== year) ||
      c.approvalHash !== c.sourceHash
    )
      throw new ApplyError("CLAUSE_NOT_READY", 409, c.key);
    if (c.appliedHash === changeDigest(c))
      throw new ApplyError("ALREADY_APPLIED", 409, c.key);
    if (
      d.fileId !== fileId ||
      !["insert", "replace", "keep", "schedule"].includes(d.action)
    )
      throw new ApplyError("TARGET_REQUIRED", 409, c.key);
    if (d.action === "keep") continue;
    if (!d.final.trim() && !(d.action === "schedule" && d.deferred))
      throw new ApplyError("FINAL_TEXT_REQUIRED", 409, c.key);
    const scope = d.anchor
      ? scopes.find((s) => s.label === d.anchor)
      : undefined;
    if (d.anchor && !scope && d.action !== "schedule")
      throw new ApplyError("ANCHOR_NOT_FOUND", 409, c.key);
    if (d.action === "schedule") {
      const result = scheduleClause(source, c, year, allClauses);
      return validate ? validatePatched(source, result) : result;
    } else if (d.action === "insert") {
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
  return validate ? validatePatched(source, result) : result;
}
function validatePatched(source: string, result: string) {
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
