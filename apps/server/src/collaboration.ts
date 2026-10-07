import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import { identity, requireOrigin } from "./auth.js";
import { access, change } from "./store.js";
import { pool, Fault } from "./db.js";
import { file } from "./routes.js";
import { updateDocument } from "./codec.js";
import { config } from "./config.js";
import { SCHEMA_VERSION } from "../../../packages/codec/src/index.js";
const positionId = z.object({
  client: z.number().int().nonnegative(),
  clock: z.number().int().nonnegative(),
});
const relativePosition = z.object({
  type: positionId.nullable().optional(),
  tname: z.string().nullable().optional(),
  item: positionId.nullable().optional(),
  assoc: z.number().int().optional(),
});
const cursorState = z
  .object({ anchor: relativePosition, head: relativePosition })
  .nullable()
  .optional();
const rooms = new Map<
  string,
  Set<{
    ws: WebSocket;
    user: string;
    clientId: number;
    session: string;
    state?: unknown;
  }>
>();
export function disconnectProject(id: string) {
  for (const [room, sockets] of rooms)
    if (room.startsWith(id + "/"))
      for (const s of sockets) s.ws.close(4409, "RESYNC_REQUIRED");
}
export function disconnectUser(id: string) {
  for (const sockets of rooms.values())
    for (const s of sockets)
      if (s.user === id) s.ws.close(4401, "UNAUTHENTICATED");
}
const send = (ws: WebSocket, data: unknown) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
};
export async function collaboration(app: FastifyInstance) {
  app.get(
    "/api/projects/:pid/documents/:fid/ws",
    { websocket: true },
    (ws, req) => {
      const { pid, fid } = req.params as { pid: string; fid: string };
      let room = "";
      let member: any;
      let queue = Promise.resolve();
      let epoch = 0;
      const initialization = (async () => {
        requireOrigin(req);
        const q = z
          .object({
            epoch: z.coerce.number().int(),
            schema: z.coerce.number().int(),
            clientId: z.coerce.number().int().nonnegative(),
          })
          .parse(req.query);
        epoch = q.epoch;
        if (q.schema !== SCHEMA_VERSION)
          throw new Fault("SCHEMA_MISMATCH", 409);
        const u = await identity(req),
          p = await access(pool, pid, u.id),
          f = file(p, fid);
        if (f.epoch !== epoch || f.mode !== "visual")
          throw new Fault("STALE_DOCUMENT", 409);
        room = `${pid}/${fid}/${epoch}`;
        if (!rooms.has(room)) rooms.set(room, new Set());
        if ([...rooms.get(room)!].some((peer) => peer.clientId === q.clientId))
          throw new Fault("CLIENT_ID_CONFLICT", 409);
        member = { ws, user: u.id, session: u.session, clientId: q.clientId };
        rooms.get(room)!.add(member);
        send(ws, {
          type: "sync",
          state: f.state,
          preservation: f.preservation,
          revision: p.revision,
          role: p.role,
        });
        for (const peer of rooms.get(room)!)
          if (peer !== member && peer.state)
            send(ws, {
              type: "presence",
              clientId: peer.clientId,
              state: peer.state,
            });
      })();
      initialization.catch((e) => {
        send(ws, { type: "error", code: e.code || "CONNECTION_FAILED" });
        ws.close(4403);
      });
      ws.on("message", (raw) => {
        queue = queue
          .then(async () => {
            await initialization;
            const u = await identity(req);
            const m = JSON.parse(raw.toString());
            if (m.type === "presence") {
              await access(pool, pid, u.id);
              if (JSON.stringify(m.state).length > 8192)
                throw new Fault("PRESENCE_LIMIT");
              const state = m.state
                ? {
                    cursor: cursorState.parse(m.state.cursor),
                    user: { name: u.name, color: "#237f79" },
                  }
                : null;
              member.state = state;
              for (const peer of rooms.get(room) || [])
                if (peer !== member)
                  send(peer.ws, {
                    type: "presence",
                    clientId: member.clientId,
                    state,
                  });
              return;
            }
            const b = z
              .object({
                type: z.literal("update"),
                id: z.uuid(),
                update: z.string().max(config.documentBytes * 2),
              })
              .parse(m);
            const persisted = await change(
              pid,
              u,
              undefined,
              "editor",
              async (p, db) => {
                const f = file(p, fid);
                if (f.epoch !== epoch || f.mode !== "visual")
                  throw new Fault("STALE_DOCUMENT", 409);
                const prior = await db.query(
                  "SELECT user_id FROM updates WHERE document_id=$1 AND epoch=$2 AND message_id=$3",
                  [fid, epoch, b.id],
                );
                if (prior.rowCount) {
                  if (prior.rows[0].user_id !== u.id)
                    throw new Fault("MESSAGE_CONFLICT", 409);
                  return { duplicate: true };
                }
                const bytes = Buffer.from(b.update, "base64");
                if (bytes.length > config.documentBytes)
                  throw new Fault("DOCUMENT_LIMIT", 413);
                const next = updateDocument(f.state!, bytes, f.preservation!);
                if (Buffer.byteLength(next.state) > config.documentBytes * 8)
                  throw new Fault("STATE_LIMIT", 413);
                Object.assign(f, next);
                await db.query(
                  "INSERT INTO updates(document_id,epoch,message_id,user_id,bytes) VALUES($1,$2,$3,$4,$5)",
                  [fid, epoch, b.id, u.id, bytes],
                );
                return { duplicate: false };
              },
              { build: true, document: true, noChange: (r) => r.duplicate },
            );
            send(ws, { type: "ack", id: b.id, revision: persisted.revision });
            if (!persisted.result.duplicate)
              for (const peer of rooms.get(room) || [])
                if (peer !== member)
                  send(peer.ws, {
                    type: "update",
                    update: b.update,
                    revision: persisted.revision,
                  });
          })
          .catch((e) => {
            send(ws, {
              type: "error",
              code: e.code || "INVALID_UPDATE",
              params: e.params,
            });
            if (
              [
                "STALE_DOCUMENT",
                "FORBIDDEN",
                "UNAUTHENTICATED",
                "NOT_FOUND",
              ].includes(e.code)
            )
              ws.close(4409, e.code);
          });
      });
      const timer = setInterval(() => {
        void identity(req)
          .then((u) => access(pool, pid, u.id))
          .catch(() => ws.close(4403));
      }, 15000);
      ws.on("close", () => {
        clearInterval(timer);
        const peers = rooms.get(room);
        peers?.delete(member);
        for (const peer of peers || [])
          send(peer.ws, {
            type: "presence",
            clientId: member?.clientId,
            state: null,
          });
        if (!peers?.size) rooms.delete(room);
      });
    },
  );
}
