import { randomUUID } from "node:crypto";
import type pg from "pg";
import { structuredPatch } from "diff";
import type { Identity } from "./auth.js";
import type { Project } from "./model.js";
import { config } from "./config.js";
import { appendBatch, indexHistory } from "./edit-history.js";
import { Fault } from "./db.js";

// Capture content, not CRDT state or lock/presence bookkeeping. Patches are
// stored in the same transaction as the content and its server-verified actor.
export function changeSnapshot(p: Project) {
  const files = p.data.files.map((f) => ({
    id: f.id,
    path: f.path,
    source: f.source,
    blob: f.blob,
    bytes: f.bytes,
    kind: f.kind,
  }));
  return {
    files,
    settings: JSON.stringify(
      {
        name: p.name,
        target: p.data.target,
        autoBuild: p.data.autoBuild,
        numbering: p.data.numbering,
      },
      null,
      2,
    ),
  };
}
export async function recordChange(
  db: pg.PoolClient,
  p: Project,
  user: Identity,
  before: ReturnType<typeof changeSnapshot>,
) {
  const after = changeSnapshot(p);
  const changes: any[] = [];
  for (const id of new Set(
    [...before.files, ...after.files].map((f) => f.id),
  )) {
    const old = before.files.find((f) => f.id === id),
      now = after.files.find((f) => f.id === id);
    if (
      old?.source === now?.source &&
      old?.path === now?.path &&
      old?.blob === now?.blob &&
      old?.bytes === now?.bytes
    )
      continue;
    const path = now?.path || old!.path;
    const patch = structuredPatch(
      old?.path || path,
      path,
      old?.source || "",
      now?.source || "",
      "",
      "",
      { context: 3 },
    );
    changes.push({
      path,
      previousPath: old?.path,
      kind: !old
        ? "added"
        : !now
          ? "removed"
          : old.path !== now.path
            ? "renamed"
            : "edited",
      binary: (now || old)?.kind === "image",
      before: old?.source || "",
      after: now?.source || "",
      patch,
    });
  }
  if (before.settings !== after.settings)
    changes.push({
      path: "프로젝트 설정",
      kind: "settings",
      before: before.settings,
      after: after.settings,
      patch: structuredPatch(
        "settings",
        "settings",
        before.settings,
        after.settings,
        "",
        "",
        { context: 3 },
      ),
    });
  if (!changes.length) return;
  await indexHistory(db, p, before);
  const atomic = changes.map(({ before, after, ...f }) => f);
  const size = Buffer.byteLength(JSON.stringify(atomic));
  const used = await db.query(
    "SELECT COALESCE(sum(size),0) AS bytes FROM content_changes WHERE project_id=$1",
    [p.id],
  );
  if (Number(used.rows[0].bytes) + size > config.historyBytes)
    throw new Fault("HISTORY_LIMIT", 413, { limit: config.historyBytes });
  const id = randomUUID(),
    created = new Date();
  const actor_key =
    user.id === "anonymous" ? `${user.id}:${user.session}` : user.id;
  await db.query(
    "INSERT INTO content_changes(id,project_id,revision,actor,actor_key,actor_name,changes,size,created) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      id,
      p.id,
      p.revision,
      user.id,
      actor_key,
      user.name,
      JSON.stringify(atomic),
      size,
      created,
    ],
  );
  await appendBatch(db, p.id, {
    id,
    revision: p.revision,
    actor: user.id,
    actor_key,
    actor_name: user.name,
    changes,
    created,
  });
}
