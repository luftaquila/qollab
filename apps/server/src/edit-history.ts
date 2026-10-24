import { randomUUID } from "node:crypto";
import { applyPatch, reversePatch, structuredPatch } from "diff";
import type pg from "pg";
import type { Project } from "./model.js";
import { changeSnapshot } from "./changes.js";

type Edit = {
  id: string;
  revision: number;
  first_revision?: number;
  actor: string;
  actor_key?: string;
  actor_name: string;
  changes: any[];
  created: Date;
  updated?: Date;
};
const patch = (f: any) =>
  structuredPatch(f.previousPath || f.path, f.path, f.before, f.after, "", "", {
    context: 3,
  });
function sameFile(a: any, b: any) {
  return (
    a.path === b.path &&
    a.kind === "edited" &&
    b.kind === "edited" &&
    !a.binary &&
    !b.binary
  );
}
export async function appendBatch(db: pg.PoolClient, pid: string, edit: Edit) {
  const previous = (
    await db.query(
      "SELECT * FROM edit_batches WHERE project_id=$1 ORDER BY revision DESC LIMIT 1",
      [pid],
    )
  ).rows[0];
  const key = actorKey(edit);
  const time = new Date(edit.created).getTime();
  const join =
    previous &&
    previous.actor_key === key &&
    previous.actor_name === edit.actor_name &&
    time - new Date(previous.updated).getTime() <= 90000 &&
    time - new Date(previous.created).getTime() <= 300000 &&
    previous.changes.length === 1 &&
    edit.changes.length === 1 &&
    sameFile(previous.changes[0], edit.changes[0]) &&
    typeof previous.changes[0].before === "string" &&
    typeof edit.changes[0].after === "string";
  if (join) {
    const f = { ...edit.changes[0], before: previous.changes[0].before };
    f.patch = patch(f);
    await db.query(
      "UPDATE edit_batches SET revision=$2,updated=$3,changes=$4 WHERE id=$1",
      [previous.id, edit.revision, edit.created, JSON.stringify([f])],
    );
  } else {
    if (previous)
      await db.query("UPDATE edit_batches SET changes=$2 WHERE id=$1", [
        previous.id,
        JSON.stringify(compact(previous.changes)),
      ]);
    await db.query(
      "INSERT INTO edit_batches(id,project_id,first_revision,revision,actor,actor_key,actor_name,changes,created,updated) VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8,$8)",
      [
        edit.id || randomUUID(),
        pid,
        edit.revision,
        edit.actor,
        key,
        edit.actor_name,
        JSON.stringify(edit.changes),
        edit.created,
      ],
    );
  }
}
const actorKey = (edit: Edit) =>
  edit.actor_key || `${edit.actor}:${edit.actor_name}`;
function compact(changes: any[]) {
  return changes.map((f) => {
    const section = summarizeEdit(f).section;
    const { before, after, ...rest } = f;
    return { ...rest, section };
  });
}
/** Stream backwards under the project lock; retain full text only for the active batch. */
export async function indexHistory(
  db: pg.PoolClient,
  project: Project,
  snapshot = changeSnapshot(project),
) {
  if (
    (
      await db.query("SELECT 1 FROM edit_index WHERE project_id=$1", [
        project.id,
      ])
    ).rowCount
  )
    return;
  const text = new Map(snapshot.files.map((f) => [f.path, f.source || ""]));
  text.set("프로젝트 설정", snapshot.settings);
  let cursor: string | null = null,
    batch: Edit | undefined,
    newest = true;
  const flush = async () => {
    if (!batch) return;
    await db.query(
      "INSERT INTO edit_batches(id,project_id,first_revision,revision,actor,actor_key,actor_name,changes,created,updated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        batch.id,
        project.id,
        batch.first_revision,
        batch.revision,
        batch.actor,
        actorKey(batch),
        batch.actor_name,
        JSON.stringify(newest ? batch.changes : compact(batch.changes)),
        batch.created,
        batch.updated,
      ],
    );
    newest = false;
  };
  while (true) {
    const rows: Edit[] = (
      await db.query(
        "SELECT * FROM content_changes WHERE project_id=$1 AND ($2::bigint IS NULL OR revision<$2) ORDER BY revision DESC LIMIT 100",
        [project.id, cursor],
      )
    ).rows;
    if (!rows.length) break;
    for (const edit of rows) {
      for (const f of [...edit.changes].reverse()) {
        if (f.binary) continue;
        const after = text.get(f.path) || "";
        const before = applyPatch(after, reversePatch(f.patch));
        if (before !== false) {
          f.before = before;
          f.after = after;
        }
        if (f.kind === "added") text.delete(f.path);
        else {
          if (f.previousPath && f.previousPath !== f.path) text.delete(f.path);
          text.set(f.previousPath || f.path, before === false ? "" : before);
        }
      }
      const join =
        batch &&
        actorKey(batch) === actorKey(edit) &&
        batch.actor_name === edit.actor_name &&
        new Date(batch.created).getTime() - new Date(edit.created).getTime() <=
          90000 &&
        new Date(batch.updated!).getTime() - new Date(edit.created).getTime() <=
          300000 &&
        batch.changes.length === 1 &&
        edit.changes.length === 1 &&
        sameFile(batch.changes[0], edit.changes[0]) &&
        typeof edit.changes[0].before === "string" &&
        typeof batch.changes[0].after === "string";
      if (join && batch) {
        batch.changes[0].before = edit.changes[0].before;
        batch.changes[0].patch = patch(batch.changes[0]);
        batch.id = edit.id;
        batch.first_revision = edit.revision;
        batch.created = edit.created;
      } else {
        await flush();
        batch = {
          ...edit,
          first_revision: edit.revision,
          updated: edit.created,
        };
      }
      cursor = String(edit.revision);
    }
  }
  await flush();
  await db.query("INSERT INTO edit_index(project_id) VALUES($1)", [project.id]);
}
export function summarizeEdit(f: any) {
  const lines = f.patch.hunks.flatMap((h: any) => h.lines as string[]);
  const before = lines
    .filter((l: string) => l.startsWith("-"))
    .map((l: string) => l.slice(1))
    .join("\n");
  const after = lines
    .filter((l: string) => l.startsWith("+"))
    .map((l: string) => l.slice(1))
    .join("\n");
  let common = 0;
  while (
    common < before.length &&
    common < after.length &&
    before[common] === after[common]
  )
    common++;
  const excerpt = (s: string) =>
    (common > 35 ? "…" : "") +
    s.slice(Math.max(0, common - 35), common + 125) +
    (s.length > common + 125 ? "…" : "");
  const line = f.patch.hunks[0]?.newStart || 1;
  const section =
    f.section ||
    (typeof f.after === "string"
      ? f.after
          .split("\n")
          .slice(0, line)
          .reverse()
          .find((l: string) => /^#{1,6}\s+/.test(l))
          ?.replace(/^#+\s+/, "")
      : undefined);
  return {
    path: f.path,
    kind: f.kind,
    binary: f.binary,
    section,
    before: excerpt(before),
    after: excerpt(after),
  };
}
