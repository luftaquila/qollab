import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { hasActiveEditors } from "./collaboration.js";
import { identity, mutation, sameSecret } from "./auth.js";
import { pool, transaction, Fault } from "./db.js";
import {
  access,
  change,
  events,
  queueBuild,
  writable,
  mirror,
} from "./store.js";
import { renderPolicy } from "../../../packages/codec/src/render-policy.js";
export async function builds(app: FastifyInstance) {
  const service = (req: FastifyRequest) => {
    if (
      !sameSecret(
        String(req.headers.authorization || ""),
        "Bearer " + config.rendererToken,
      ) ||
      !config.rendererToken
    )
      throw new Fault("FORBIDDEN", 403);
  };
  app.get("/api/renderer/activity", async (req) => {
    service(req);
    return { editing: hasActiveEditors() };
  });
  app.post("/api/projects/:pid/builds", async (req) => {
    const u = await mutation(req),
      b = z.object({ revision: z.number() }).parse(req.body);
    return change(
      (req.params as any).pid,
      u,
      b.revision,
      "editor",
      async (p, db) => {
        await queueBuild(db, { ...p, revision: p.revision + 1 }, true);
      },
      { build: false },
    );
  });
  app.get("/api/projects/:pid/builds", async (req) => {
    const u = await identity(req),
      id = (req.params as any).pid;
    await access(pool, id, u.id);
    return (
      await pool.query(
        "SELECT id,revision,epoch,target,status,log,image,created,finished FROM builds WHERE project_id=$1 ORDER BY created DESC LIMIT 30",
        [id],
      )
    ).rows;
  });
  app.get("/api/projects/:pid/pdf", async (req, reply) => {
    const u = await identity(req),
      p = await access(pool, (req.params as any).pid, u.id);
    if (!p.data.pdfBuild) throw new Fault("PDF_UNAVAILABLE", 404);
    const r = await pool.query(
      "SELECT pdf FROM builds WHERE id=$1 AND project_id=$2",
      [p.data.pdfBuild, p.id],
    );
    if (!r.rows[0]?.pdf) throw new Fault("PDF_UNAVAILABLE", 404);
    return reply
      .type("application/pdf")
      .header("Cache-Control", "private, no-cache")
      .header("X-Qollab-Revision", String(p.data.pdfRevision))
      .send(r.rows[0].pdf);
  });
  app.post("/api/projects/:pid/builds/:bid/cancel", async (req) => {
    const u = await mutation(req);
    const b = z.object({ revision: z.number() }).parse(req.body);
    return change(
      (req.params as any).pid,
      u,
      b.revision,
      "editor",
      async (p, db) => {
        await db.query(
          "UPDATE builds SET status='cancelled',finished=now() WHERE id=$1 AND project_id=$2 AND status IN ('queued','running')",
          [(req.params as any).bid, p.id],
        );
      },
      { build: false },
    );
  });
  app.post("/api/renderer/lease", async (req) => {
    service(req);
    return transaction(async (db) => {
      await writable(db);
      await db.query("SELECT pg_advisory_xact_lock(917241)");
      await db.query(
        "UPDATE builds SET status='failed',log='RENDERER_LEASE_EXPIRED',finished=now() WHERE status='running' AND lease_until<now()",
      );
      const active = await db.query(
        "SELECT id FROM builds WHERE status='running'",
      );
      if (active.rowCount) return null;
      const r = await db.query(
        "SELECT * FROM builds WHERE status='queued' AND lease_until<=now() ORDER BY created LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!r.rowCount) return null;
      const b = r.rows[0];
      try {
        renderPolicy(b.input.files);
      } catch (error) {
        await db.query(
          "UPDATE builds SET status='failed',log=$2,finished=now() WHERE id=$1",
          [b.id, String(error)],
        );
        events(b.project_id, { type: "build" });
        return null;
      }
      const lease = randomUUID();
      await db.query(
        "UPDATE builds SET status='running',lease=$2,lease_until=now()+$3*interval '1 second' WHERE id=$1",
        [b.id, lease, config.buildSeconds + 30],
      );
      events(b.project_id, { type: "build" });
      return {
        id: b.id,
        cacheKey: createHash("sha256")
          .update(
            JSON.stringify([
              b.project_id,
              b.epoch,
              b.target,
              b.input.generations,
            ]),
          )
          .digest("hex"),
        lease,
        target: b.target,
        revision: Number(b.revision),
        epoch: b.epoch,
        timeout: config.buildSeconds,
      };
    });
  });
  app.get("/api/renderer/builds/:bid/status", async (req) => {
    service(req);
    const r = await pool.query(
      "SELECT status FROM builds WHERE id=$1 AND lease=$2 AND status='running' AND lease_until>now()",
      [(req.params as any).bid, String(req.headers["x-render-lease"])],
    );
    if (!r.rowCount) throw new Fault("LEASE_EXPIRED", 409);
    return { running: true };
  });
  app.get("/api/renderer/builds/:bid/input", async (req) => {
    service(req);
    const r = await pool.query(
      "SELECT input FROM builds WHERE id=$1 AND lease=$2 AND status='running' AND lease_until>now()",
      [(req.params as any).bid, String(req.headers["x-render-lease"])],
    );
    if (!r.rowCount) throw new Fault("LEASE_EXPIRED", 409);
    return r.rows[0].input;
  });
  app.post("/api/renderer/builds/:bid/result", async (req) => {
    service(req);
    const body = z
        .object({
          lease: z.uuid(),
          pdf: z.string().optional(),
          log: z.string().max(65536),
          image: z.string().max(512),
        })
        .parse(req.body),
      id = (req.params as any).bid;
    const pdf = body.pdf ? Buffer.from(body.pdf, "base64") : null;
    if (
      pdf &&
      (pdf.length > 50 * 1024 * 1024 ||
        !pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
    )
      throw new Fault("INVALID_PDF");
    return transaction(async (db) => {
      await writable(db);
      const lookup = await db.query(
        "SELECT project_id FROM builds WHERE id=$1",
        [id],
      );
      if (!lookup.rowCount) throw new Fault("NOT_FOUND", 404);
      const p = await db.query(
        "SELECT * FROM projects WHERE id=$1 FOR UPDATE",
        [lookup.rows[0].project_id],
      );
      const r = await db.query(
        "SELECT * FROM builds WHERE id=$1 AND lease=$2 AND status='running' AND lease_until>now() FOR UPDATE",
        [id, body.lease],
      );
      if (!r.rowCount) throw new Fault("LEASE_EXPIRED", 409);
      const b = r.rows[0];
      await db.query(
        "UPDATE builds SET status=$2,pdf=$3,log=$4,image=$5,finished=now() WHERE id=$1",
        [id, pdf ? "succeeded" : "failed", pdf, body.log, body.image],
      );
      const data = p.rows[0].data;
      if (
        pdf &&
        data.epoch === b.epoch &&
        Number(b.revision) >= (data.pdfRevision ?? -1)
      ) {
        data.pdfBuild = id;
        data.pdfRevision = Number(b.revision);
        await db.query("UPDATE projects SET data=$2 WHERE id=$1", [
          b.project_id,
          data,
        ]);
      }
      events(b.project_id, { type: "build" });
      return { ok: true };
    });
  });
  app.post("/api/admin/freeze", async (req) => {
    if (
      !config.adminToken ||
      !sameSecret(
        String(req.headers.authorization || ""),
        "Bearer " + config.adminToken,
      )
    )
      throw new Fault("FORBIDDEN", 403);
    const b = z
      .object({ frozen: z.boolean(), backupId: z.string().optional() })
      .parse(req.body);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(917240)");
      await db.query("UPDATE maintenance SET frozen=$1,backup_id=$2", [
        b.frozen,
        b.backupId || null,
      ]);
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    if (b.frozen) {
      const all = await pool.query("SELECT id FROM projects");
      for (const p of all.rows) await mirror(p.id);
    }
    return { frozen: b.frozen, backupId: b.backupId };
  });
}
