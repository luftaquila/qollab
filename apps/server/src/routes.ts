import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { pool, transaction, Fault } from "./db.js";
import { identity, mutation, token, hash } from "./auth.js";
import {
  access,
  change,
  checkpoint,
  mirror,
  audit,
  events,
  subscribe,
  writable,
  validateSize,
  queueBuild,
} from "./store.js";
import { initialize } from "./codec.js";
import {
  safePath,
  safeFolder,
  relativeAsset,
  resolveReference,
} from "./paths.js";
import { config } from "./config.js";
import { readZip, writeZip } from "./archive.js";
import { blobId, content, storeBlobs } from "./blobs.js";
import type { Project, ProjectFile, ProjectData } from "./model.js";
const rev = z.number().int().nonnegative();
const name = z.string().min(1).max(160);
const params = (r: any) =>
  r.params as { pid: string; fid: string; cid: string; uid: string };
// rawOwner/rawUntil tell other members who holds the Markdown editing lock.
export const publicFile = (f: ProjectFile) => {
  const { state, preservation, bytes, blob, ...rest } = f;
  return rest;
};
export function file(p: Project, id: string) {
  const f = p.data.files.find((f) => f.id === id);
  if (!f) throw new Fault("NOT_FOUND", 404);
  return f;
}
async function image(bytes: Buffer) {
  if (bytes.length > config.imageBytes) throw new Fault("IMAGE_LIMIT", 413);
  try {
    const s = sharp(bytes, {
      limitInputPixels: config.pixels,
      failOn: "warning",
    });
    const meta = await s.metadata();
    if (!["png", "jpeg"].includes(meta.format!)) throw new Error();
    await s.raw().toBuffer();
    return {
      mime: meta.format === "png" ? "image/png" : "image/jpeg",
      extension: meta.format === "png" ? "png" : "jpg",
    };
  } catch {
    throw new Fault("INVALID_IMAGE");
  }
}
function textFile(path: string, source: string): ProjectFile {
  return {
    id: randomUUID(),
    path,
    kind: path.endsWith(".qmd") ? "document" : "text",
    source,
    epoch: 1,
    ...(path.endsWith(".qmd") ? initialize(source) : {}),
  };
}
/**
 * Moves one file and rewrites relative Markdown links that point to it or that
 * it contains. Ambiguous textual references stop the move instead of guessing.
 */
function moveFile(p: Project, f: ProjectFile, path: string) {
  if (f.path === "_quarto.yml" || path === "_quarto.yml")
    if (p.role !== "owner") throw new Fault("FORBIDDEN", 403);
  if (
    (f.kind === "image" &&
      f.path.split(".").pop()!.toLowerCase() !==
        path.split(".").pop()!.toLowerCase()) ||
    (f.kind === "document" && !path.endsWith(".qmd")) ||
    (f.kind === "text" && path.endsWith(".qmd"))
  )
    throw new Fault("RENAME_TYPE");
  if (p.data.files.some((x) => x.path === path))
    throw new Fault("PATH_EXISTS", 409);
  const old = f.path;
  for (const other of p.data.files) {
    if (!other.source) continue;
    const oldRelative = relativeAsset(other.path, old);
    const futurePath = other.id === f.id ? path : other.path;
    const link = /(!?\[[^\]\n]*\]\()([^\s)]+)([^)]*\))/g;
    const unmatched = other.source.replace(link, "");
    if (unmatched.includes(oldRelative) || unmatched.includes(old))
      throw new Fault("RELATIVE_REFERENCES", 409);
    const next = other.source.replace(link, (full, prefix, dest, suffix) => {
      if (/^[a-z]+:|^#|^\//i.test(dest)) return full;
      const [location, fragment] = dest.split("#", 2);
      const resolved = resolveReference(other.path, location);
      const target = resolved === old ? path : resolved;
      if (resolved !== old && futurePath === other.path) return full;
      return (
        prefix +
        relativeAsset(futurePath, target) +
        (fragment ? "#" + fragment : "") +
        suffix
      );
    });
    if (next !== other.source) {
      if (other.path === "_quarto.yml" && p.role !== "owner")
        throw new Fault("FORBIDDEN", 403);
      other.source = next;
      if (other.kind === "document") {
        Object.assign(other, initialize(next));
        other.epoch++;
      }
    }
  }
  f.path = path;
  if (p.data.target === old) p.data.target = path;
  return f;
}
export async function routes(
  app: FastifyInstance,
  disconnect: (project: string) => void,
) {
  app.get("/api/projects", async (req) => {
    const u = await identity(req);
    return (
      await pool.query(
        // Projects from before `updated` existed fall back to their latest checkpoint.
        "SELECT p.id,p.name,p.revision,m.role,COALESCE(p.updated,(SELECT max(c.created) FROM checkpoints c WHERE c.project_id=p.id),p.created) AS updated FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=$1 ORDER BY updated DESC",
        [u.id],
      )
    ).rows;
  });
  app.post("/api/projects", async (req) => {
    const u = await mutation(req);
    const b = z.object({ name }).parse(req.body);
    const id = randomUUID();
    const data: ProjectData = {
      files: [textFile("report.qmd", "# Untitled\n\n")],
      epoch: 1,
      target: "report.qmd",
    };
    await transaction(async (db) => {
      await writable(db);
      await db.query("INSERT INTO projects(id,name,data) VALUES($1,$2,$3)", [
        id,
        b.name,
        data,
      ]);
      await db.query("INSERT INTO members VALUES($1,$2,'owner')", [id, u.id]);
      await checkpoint(
        db,
        { id, name: b.name, revision: 0, data },
        "Initial",
        u.id,
      );
    });
    await mirror(id);
    return { id };
  });
  app.get("/api/projects/:pid", async (req) => {
    const u = await identity(req),
      p = await access(pool, params(req).pid, u.id);
    return { ...p, data: { ...p.data, files: p.data.files.map(publicFile) } };
  });
  app.patch("/api/projects/:pid", async (req) => {
    const u = await mutation(req),
      b = z
        .object({
          revision: rev,
          name: name.optional(),
          target: z.string().optional(),
        })
        .parse(req.body);
    return change(params(req).pid, u, b.revision, "owner", async (p) => {
      if (b.name) p.name = b.name;
      if (b.target) {
        if (
          !p.data.files.some(
            (f) => f.path === b.target && f.kind === "document",
          )
        )
          throw new Fault("NOT_FOUND", 404);
        p.data.target = b.target;
      }
    });
  });
  app.delete("/api/projects/:pid", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev }).parse(req.body),
      id = params(req).pid;
    await transaction(async (db) => {
      await writable(db);
      const p = await access(db, id, u.id, "owner", true);
      if (p.revision !== b.revision) throw new Fault("REVISION_CONFLICT", 409);
      await audit(db, id, u.id, "project.delete", {});
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
    });
    disconnect(id);
    return { ok: true };
  });
  app.get("/api/projects/:pid/events", async (req, reply) => {
    const u = await identity(req),
      id = params(req).pid;
    await access(pool, id, u.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("event: ready\ndata: {}\n\n");
    const send = async (event: unknown) => {
      try {
        await identity(req);
        await access(pool, id, u.id);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        reply.raw.end();
      }
    };
    const off = subscribe(id, send);
    const interval = setInterval(() => {
      void send({ type: "heartbeat" });
    }, 15000);
    req.raw.on("close", () => {
      off();
      clearInterval(interval);
    });
  });
  app.post("/api/projects/:pid/files", async (req) => {
    const u = await mutation(req),
      b = z
        .object({
          revision: rev,
          path: z.string(),
          source: z.string().default(""),
        })
        .parse(req.body);
    safePath(b.path);
    if (/\.(png|jpe?g)$/i.test(b.path)) throw new Fault("USE_IMAGE_UPLOAD");
    return change(
      params(req).pid,
      u,
      b.revision,
      b.path === "_quarto.yml" ? "owner" : "editor",
      async (p) => {
        if (p.data.files.some((f) => f.path === b.path))
          throw new Fault("PATH_EXISTS", 409);
        const f = textFile(b.path, b.source);
        p.data.files.push(f);
        return publicFile(f);
      },
    );
  });
  app.get("/api/projects/:pid/files/:fid", async (req, reply) => {
    const u = await identity(req),
      p = await access(pool, params(req).pid, u.id),
      f = file(p, params(req).fid);
    if (f.kind === "image") return reply.type(f.mime!).send(await content(f));
    return { ...publicFile(f), revision: p.revision };
  });
  app.get("/api/projects/:pid/resource", async (req, reply) => {
    const u = await identity(req),
      p = await access(pool, params(req).pid, u.id);
    const q = z.object({ path: z.string() }).parse(req.query);
    const f = p.data.files.find((f) => f.path === q.path);
    if (!f) throw new Fault("NOT_FOUND", 404);
    return reply
      .header("X-Content-Type-Options", "nosniff")
      .type(f.mime || "text/plain; charset=utf-8")
      .send(await content(f));
  });
  app.patch("/api/projects/:pid/files/:fid", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev, path: z.string() }).parse(req.body);
    safePath(b.path);
    const id = params(req).pid;
    const result = await change(id, u, b.revision, "editor", async (p) =>
      publicFile(moveFile(p, file(p, params(req).fid), b.path)),
    );
    disconnect(id);
    events(id, { type: "files" });
    return result;
  });
  app.delete("/api/projects/:pid/files/:fid", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev }).parse(req.body),
      id = params(req).pid;
    const result = await change(id, u, b.revision, "editor", async (p) => {
      const f = file(p, params(req).fid);
      if (f.path === "_quarto.yml" && p.role !== "owner")
        throw new Fault("FORBIDDEN", 403);
      for (const doc of p.data.files)
        if (doc.id !== f.id && doc.source) {
          const rel = relativeAsset(doc.path, f.path);
          if (
            doc.source.includes(rel) ||
            doc.source.includes(f.path) ||
            doc.mode === "raw"
          )
            throw new Fault("REFERENCED_FILE", 409);
        }
      p.data.files = p.data.files.filter((x) => x.id !== f.id);
      if (p.data.target === f.path)
        p.data.target =
          p.data.files.find((x) => x.kind === "document")?.path || "";
    });
    disconnect(id);
    return result;
  });
  const inside = (path: string, folder: string) =>
    path.startsWith(folder + "/");
  app.post("/api/projects/:pid/folders", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev, path: z.string() }).parse(req.body);
    safeFolder(b.path);
    return change(
      params(req).pid,
      u,
      b.revision,
      "editor",
      async (p) => {
        const folders = p.data.folders || [];
        if (
          folders.includes(b.path) ||
          p.data.files.some((f) => f.path === b.path || inside(f.path, b.path))
        )
          throw new Fault("PATH_EXISTS", 409);
        p.data.folders = [...folders, b.path].sort();
      },
      { build: false },
    );
  });
  app.patch("/api/projects/:pid/folders", async (req) => {
    const u = await mutation(req),
      b = z
        .object({ revision: rev, from: z.string(), to: z.string() })
        .parse(req.body),
      id = params(req).pid;
    safeFolder(b.from);
    safeFolder(b.to);
    if (b.to === b.from || inside(b.to, b.from))
      throw new Fault("INVALID_PATH");
    const result = await change(id, u, b.revision, "editor", async (p) => {
      const folders = p.data.folders || [],
        moving = p.data.files.filter((f) => inside(f.path, b.from));
      if (!moving.length && !folders.some((f) => f === b.from || inside(f, b.from)))
        throw new Fault("NOT_FOUND", 404);
      if (
        folders.includes(b.to) ||
        p.data.files.some((f) => f.path === b.to || inside(f.path, b.to))
      )
        throw new Fault("PATH_EXISTS", 409);
      // One transaction: either every file moves with its references, or none.
      for (const f of moving)
        moveFile(p, f, b.to + f.path.slice(b.from.length));
      p.data.folders = folders
        .map((f) =>
          f === b.from || inside(f, b.from) ? b.to + f.slice(b.from.length) : f,
        )
        .sort();
    });
    disconnect(id);
    events(id, { type: "files" });
    return result;
  });
  app.delete("/api/projects/:pid/folders", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev, path: z.string() }).parse(req.body),
      id = params(req).pid;
    safeFolder(b.path);
    const result = await change(id, u, b.revision, "editor", async (p) => {
      const removed = p.data.files.filter((f) => inside(f.path, b.path)),
        folders = p.data.folders || [];
      if (!removed.length && !folders.some((f) => f === b.path || inside(f, b.path)))
        throw new Fault("NOT_FOUND", 404);
      // Files outside the folder must not reference anything being deleted.
      for (const doc of p.data.files)
        if (!inside(doc.path, b.path) && doc.source)
          for (const f of removed) {
            const rel = relativeAsset(doc.path, f.path);
            if (
              doc.source.includes(rel) ||
              doc.source.includes(f.path) ||
              doc.mode === "raw"
            )
              throw new Fault("REFERENCED_FILE", 409);
          }
      p.data.files = p.data.files.filter((f) => !inside(f.path, b.path));
      p.data.folders = folders.filter(
        (f) => f !== b.path && !inside(f, b.path),
      );
      if (!p.data.files.some((f) => f.path === p.data.target))
        p.data.target =
          p.data.files.find((x) => x.kind === "document")?.path || "";
    });
    disconnect(id);
    events(id, { type: "files" });
    return result;
  });
  app.put("/api/projects/:pid/files/:fid/text", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev, source: z.string() }).parse(req.body);
    return change(params(req).pid, u, b.revision, "editor", async (p) => {
      const f = file(p, params(req).fid);
      if (f.kind !== "text") throw new Fault("DOCUMENT_MODE", 409);
      if (f.path === "_quarto.yml" && p.role !== "owner")
        throw new Fault("FORBIDDEN", 403);
      f.source = b.source;
    });
  });
  app.post("/api/projects/:pid/files/:fid/raw", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev }).parse(req.body),
      id = params(req).pid;
    const result = await change(id, u, b.revision, "editor", async (p) => {
      const f = file(p, params(req).fid);
      if (f.kind !== "document") throw new Fault("DOCUMENT_MODE", 409);
      if (f.rawOwner && f.rawOwner !== u.id && f.rawUntil! > Date.now())
        throw new Fault("RAW_LOCKED", 409);
      f.epoch++;
      f.mode = "raw";
      f.rawOwner = u.id;
      f.rawUntil = Date.now() + 15 * 60_000;
      f.rawVersion = (f.rawVersion || 0) + 1;
      return publicFile(f);
    });
    disconnect(id);
    return result;
  });
  app.put("/api/projects/:pid/files/:fid/raw", async (req) => {
    const u = await mutation(req),
      b = z
        .object({
          revision: rev,
          epoch: z.number(),
          rawVersion: z.number(),
          source: z.string(),
          visual: z.boolean().default(false),
        })
        .parse(req.body),
      id = params(req).pid;
    const result = await change(id, u, b.revision, "editor", async (p) => {
      const f = file(p, params(req).fid);
      if (
        f.mode !== "raw" ||
        f.epoch !== b.epoch ||
        f.rawVersion !== b.rawVersion
      )
        throw new Fault("STALE_DOCUMENT", 409);
      if (f.rawOwner !== u.id || !f.rawUntil || f.rawUntil < Date.now())
        throw new Fault("RAW_LOCKED", 409);
      f.source = b.source;
      f.rawVersion++;
      f.rawUntil = Date.now() + 15 * 60_000;
      if (b.visual) {
        const next = initialize(b.source);
        if (next.mode !== "visual") throw new Fault("UNSAFE_BOUNDARY", 409);
        Object.assign(f, next);
        f.epoch++;
        delete f.rawOwner;
        delete f.rawUntil;
      }
      return publicFile(f);
    });
    if (b.visual) disconnect(id);
    return result;
  });
  app.post("/api/projects/:pid/images", async (req) => {
    const u = await mutation(req),
      b = z
        .object({
          revision: rev,
          uploadId: z.uuid(),
          name,
          bytes: z.string(),
          documentId: z.uuid().optional(),
        })
        .parse(req.body),
      bytes = Buffer.from(b.bytes, "base64"),
      meta = await image(bytes);
    return change(params(req).pid, u, undefined, "editor", async (p) => {
      const existing = p.data.files.find((f) => f.uploadId === b.uploadId);
      if (existing) {
        const same = existing.blob
          ? existing.blob === blobId(bytes)
          : existing.bytes === b.bytes;
        if (!same) throw new Fault("UPLOAD_CONFLICT", 409);
        return {
          file: publicFile(existing),
          relative: b.documentId
            ? relativeAsset(file(p, b.documentId).path, existing.path)
            : existing.path,
        };
      }
      if (b.revision !== p.revision)
        throw new Fault("REVISION_CONFLICT", 409, { revision: p.revision });
      const id = randomUUID(),
        f: ProjectFile = {
          id,
          path: `assets/images/${id}.${meta.extension}`,
          kind: "image",
          bytes: bytes.toString("base64"),
          mime: meta.mime,
          epoch: 1,
          uploadId: b.uploadId,
          name: b.name,
        };
      p.data.files.push(f);
      return {
        file: publicFile(f),
        relative: b.documentId
          ? relativeAsset(file(p, b.documentId).path, f.path)
          : f.path,
      };
    });
  });
  app.get("/api/projects/:pid/history", async (req) => {
    const u = await identity(req);
    await access(pool, params(req).pid, u.id);
    return (
      await pool.query(
        "SELECT id,revision,label,actor,git_hash,created FROM checkpoints WHERE project_id=$1 ORDER BY created DESC",
        [params(req).pid],
      )
    ).rows;
  });
  app.post("/api/projects/:pid/history", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev, label: name }).parse(req.body);
    return change(
      params(req).pid,
      u,
      b.revision,
      "editor",
      async (p, db) => ({ id: await checkpoint(db, p, b.label, u.id) }),
      { build: false },
    );
  });
  app.get("/api/projects/:pid/history/:cid", async (req) => {
    const u = await identity(req);
    await access(pool, params(req).pid, u.id);
    const r = await pool.query(
      "SELECT id,label,revision,snapshot FROM checkpoints WHERE project_id=$1 AND id=$2",
      [params(req).pid, params(req).cid],
    );
    if (!r.rowCount) throw new Fault("NOT_FOUND", 404);
    return {
      ...r.rows[0],
      snapshot: {
        ...r.rows[0].snapshot,
        files: r.rows[0].snapshot.files.map(publicFile),
      },
    };
  });
  app.get("/api/projects/:pid/history/:cid/export", async (req, reply) => {
    const u = await identity(req);
    await access(pool, params(req).pid, u.id);
    const r = await pool.query(
      "SELECT snapshot FROM checkpoints WHERE project_id=$1 AND id=$2",
      [params(req).pid, params(req).cid],
    );
    if (!r.rowCount) throw new Fault("NOT_FOUND", 404);
    return reply
      .type("application/zip")
      .send(await writeZip(r.rows[0].snapshot.files));
  });
  app.post("/api/projects/:pid/history/:cid/restore", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: rev }).parse(req.body),
      id = params(req).pid,
      job = randomUUID();
    const result = await change(id, u, b.revision, "owner", async (p, db) => {
      const r = await db.query(
        "SELECT snapshot FROM checkpoints WHERE id=$1 AND project_id=$2",
        [params(req).cid, id],
      );
      if (!r.rowCount) throw new Fault("NOT_FOUND", 404);
      await checkpoint(db, p, "Before restore", u.id);
      const data = r.rows[0].snapshot as ProjectData;
      data.epoch = p.data.epoch + 1;
      delete data.pdfBuild;
      delete data.pdfRevision;
      for (const f of data.files) {
        const ledger = await db.query(
          "SELECT epoch FROM document_generations WHERE id=$1",
          [f.id],
        );
        f.epoch =
          Math.max(
            f.epoch,
            p.data.files.find((x) => x.id === f.id)?.epoch || 0,
            ledger.rows[0]?.epoch || 0,
          ) + 1;
        delete f.rawOwner;
        delete f.rawUntil;
        if (f.kind === "document") Object.assign(f, initialize(f.source || ""));
      }
      p.data = data;
      await checkpoint(
        db,
        { ...p, revision: p.revision + 1 },
        "Restored",
        u.id,
      );
      await db.query(
        "INSERT INTO restores(id,project_id,target,status) VALUES($1,$2,$3,'committed')",
        [job, id, params(req).cid],
      );
      await audit(db, id, u.id, "restore", { target: params(req).cid, job });
      return { job };
    });
    disconnect(id);
    await mirror(id);
    await pool.query("UPDATE restores SET status='complete' WHERE id=$1", [
      job,
    ]);
    events(id, { type: "restored" });
    return result;
  });
  app.get("/api/projects/:pid/members", async (req) => {
    const u = await identity(req);
    await access(pool, params(req).pid, u.id);
    return (
      await pool.query(
        "SELECT u.id,u.email,u.name,u.picture,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1",
        [params(req).pid],
      )
    ).rows;
  });
  app.post("/api/projects/:pid/invites", async (req) => {
    const u = await mutation(req),
      b = z
        .object({
          revision: rev,
          email: z.email(),
          role: z.enum(["editor", "viewer"]),
        })
        .parse(req.body);
    return change(
      params(req).pid,
      u,
      b.revision,
      "owner",
      async (p, db) => {
        const raw = token();
        await db.query(
          "INSERT INTO invites VALUES($1,$2,$3,$4,now()+interval '7 days')",
          [hash(raw), p.id, b.email.toLowerCase(), b.role],
        );
        await audit(db, p.id, u.id, "invite", { email: b.email, role: b.role });
        return { url: config.origin + "/?invite=" + raw };
      },
      { build: false },
    );
  });
  app.post("/api/invites/accept", async (req) => {
    const u = await mutation(req),
      b = z.object({ token: z.string() }).parse(req.body);
    return transaction(async (db) => {
      await writable(db);
      const r = await db.query(
        "DELETE FROM invites WHERE id=$1 AND expires>now() AND email=$2 RETURNING *",
        [hash(b.token), u.email.toLowerCase()],
      );
      if (!r.rowCount) throw new Fault("INVITE_INVALID", 404);
      const i = r.rows[0];
      await db.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [
        i.project_id,
      ]);
      await db.query(
        "INSERT INTO members VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [i.project_id, u.id, i.role],
      );
      await audit(db, i.project_id, u.id, "invite.accept", {});
      return { id: i.project_id };
    });
  });
  app.patch("/api/projects/:pid/members/:uid", async (req) => {
    const u = await mutation(req),
      b = z
        .object({
          revision: rev,
          role: z.enum(["owner", "editor", "viewer"]).nullable(),
          transfer: z.boolean().default(false),
        })
        .parse(req.body),
      id = params(req).pid;
    const result = await change(
      id,
      u,
      b.revision,
      "owner",
      async (p, db) => {
        const target = params(req).uid,
          r = await db.query(
            "SELECT role FROM members WHERE project_id=$1 AND user_id=$2",
            [id, target],
          );
        if (!r.rowCount) throw new Fault("NOT_FOUND", 404);
        if (r.rows[0].role === "owner" && b.role !== "owner") {
          const owners = await db.query(
            "SELECT user_id FROM members WHERE project_id=$1 AND role='owner'",
            [id],
          );
          if (owners.rowCount === 1) throw new Fault("LAST_OWNER", 409);
        }
        if (b.role)
          await db.query(
            "UPDATE members SET role=$3 WHERE project_id=$1 AND user_id=$2",
            [id, target, b.role],
          );
        else
          await db.query(
            "DELETE FROM members WHERE project_id=$1 AND user_id=$2",
            [id, target],
          );
        if (b.transfer) {
          if (b.role !== "owner" || target === u.id)
            throw new Fault("TRANSFER_INVALID");
          await db.query(
            "UPDATE members SET role='editor' WHERE project_id=$1 AND user_id=$2",
            [id, u.id],
          );
        }
        await audit(db, id, u.id, "member.change", {
          target,
          role: b.role,
          transfer: b.transfer,
        });
      },
      { build: false },
    );
    disconnect(id);
    events(id, { type: "permissions" });
    return result;
  });
  app.get("/api/projects/:pid/export", async (req, reply) => {
    const u = await identity(req),
      p = await access(pool, params(req).pid, u.id);
    return reply
      .type("application/zip")
      .header("Content-Disposition", 'attachment; filename="project.zip"')
      .send(await writeZip(p.data.files));
  });
  app.post("/api/import", async (req) => {
    const u = await mutation(req),
      b = z.object({ name, bytes: z.string() }).parse(req.body);
    const entries = readZip(Buffer.from(b.bytes, "base64")),
      files: ProjectFile[] = [];
    for (const [path, bytes] of Object.entries(entries)) {
      if (/\.(png|jpe?g)$/i.test(path)) {
        const meta = await image(Buffer.from(bytes));
        files.push({
          id: randomUUID(),
          path,
          kind: "image",
          bytes: Buffer.from(bytes).toString("base64"),
          mime: meta.mime,
          epoch: 1,
        });
      } else
        files.push(
          textFile(
            path,
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          ),
        );
    }
    const data: ProjectData = {
      epoch: 1,
      files,
      target: files.find((f) => f.kind === "document")?.path || "",
    };
    validateSize(data);
    const id = randomUUID();
    await transaction(async (db) => {
      await writable(db);
      await storeBlobs(db, data.files);
      await db.query("INSERT INTO projects(id,name,data) VALUES($1,$2,$3)", [
        id,
        b.name,
        data,
      ]);
      await db.query("INSERT INTO members VALUES($1,$2,'owner')", [id, u.id]);
      await checkpoint(
        db,
        { id, name: b.name, revision: 0, data },
        "Imported",
        u.id,
      );
    });
    await mirror(id);
    return { id };
  });
}
