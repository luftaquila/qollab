import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { config } from "./config.js";
/** Optional local/Compose gateway. Kubernetes may route /apply to its own Service. */
export async function applyProxy(app: FastifyInstance) {
  if (!config.applyOrigin) return;
  const origin = new URL(config.applyOrigin).origin;
  app.route({
    method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    url: "/apply/*",
    handler: async (req, reply) => {
      try {
        const response = await fetch(new URL(req.url, origin), {
          method: req.method,
          redirect: "manual",
          signal: AbortSignal.timeout(180000),
          headers: {
            cookie: req.headers.cookie || "",
            origin: req.headers.origin || "",
            "x-csrf-token": String(req.headers["x-csrf-token"] || ""),
            "content-type": "application/json",
          },
          body: ["GET", "HEAD"].includes(req.method)
            ? undefined
            : JSON.stringify(req.body),
        });
        reply.code(response.status);
        for (const [key, value] of response.headers)
          if (
            ![
              "content-encoding",
              "content-length",
              "transfer-encoding",
              "connection",
            ].includes(key)
          )
            reply.header(key, value);
        return reply.send(
          response.body ? Readable.fromWeb(response.body as any) : null,
        );
      } catch {
        return reply.code(503).send({ code: "APPLY_UNAVAILABLE" });
      }
    },
  });
  app.get("/apply", async (_req, reply) => reply.redirect("/apply/"));
}
