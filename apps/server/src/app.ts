import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { config } from "./config.js";
import { Fault, pool, migrate, transaction } from "./db.js";
import { initCodec } from "./codec.js";
import { authRoutes } from "./auth.js";
import { routes } from "./routes.js";
import {
  collaboration,
  disconnectProject,
  disconnectUser,
} from "./collaboration.js";
import { builds } from "./builds.js";
import { checkpoint, mirror, recover, writable } from "./store.js";
import type { Configuration } from "openid-client";
export async function createApp(
  options: { oidc?: Configuration; logger?: boolean } = {},
) {
  await migrate();
  await initCodec();
  await recover();
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: Math.ceil(config.projectBytes * 1.4),
    requestTimeout: 30000,
  });
  await app.register(cookie);
  await app.register(websocket, {
    options: { maxPayload: config.documentBytes * 2 },
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.googleusercontent.com; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof Fault)
      return reply
        .code(error.status)
        .send({ code: error.code, params: error.params });
    if (error instanceof ZodError)
      return reply.code(400).send({ code: "INVALID_REQUEST", params: {} });
    req.log.error(error);
    return reply
      .code((error as any).statusCode || 500)
      .send({ code: "INTERNAL_ERROR", params: {} });
  });
  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });
  await authRoutes(app, disconnectUser, options.oidc);
  await routes(app, disconnectProject);
  await collaboration(app);
  await builds(app);
  const root = resolve("apps/web/dist");
  if (existsSync(root)) {
    await app.register(staticPlugin, { root });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/"))
        return reply.code(404).send({ code: "NOT_FOUND" });
      return reply.sendFile("index.html");
    });
  }
  const timer = setInterval(() => {
    void transaction(async (db) => {
      await writable(db);
      const all = await db.query("SELECT * FROM projects FOR UPDATE");
      for (const p of all.rows) {
        const r = await db.query(
          "SELECT revision FROM checkpoints WHERE project_id=$1 ORDER BY created DESC LIMIT 1",
          [p.id],
        );
        if (!r.rowCount || Number(r.rows[0].revision) !== Number(p.revision))
          await checkpoint(db, p, "Automatic", null);
      }
    })
      .then(async () => {
        const all = await pool.query("SELECT id FROM projects");
        for (const p of all.rows) await mirror(p.id);
      })
      .catch((e) => {
        if (e.code !== "MAINTENANCE") app.log.error(e);
      });
  }, config.checkpointMs);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  return app;
}
