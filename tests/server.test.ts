import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import * as Y from "yjs";
import sharp from "sharp";
import { createApp } from "../apps/server/src/app.js";
import { pool } from "../apps/server/src/db.js";
import { token, hash, validateClaims } from "../apps/server/src/auth.js";
import { config } from "../apps/server/src/config.js";
let app: Awaited<ReturnType<typeof createApp>>;
const people: any = {};
const sockets: WebSocket[] = [];
async function request(
  user: string,
  url: string,
  method = "GET",
  body?: unknown,
) {
  const p = people[user];
  return app.inject({
    url: "/api" + url,
    method: method as any,
    headers: {
      cookie: "qollab=" + p.raw,
      origin: config.origin,
      "x-csrf-token": p.csrf,
    },
    payload: body as any,
  });
}
async function project() {
  const r = await request("owner", "/projects", "POST", {
    name: "Integration " + randomUUID(),
  });
  expect(r.statusCode, r.body).toBe(200);
  return (await request("owner", "/projects/" + r.json().id)).json();
}
async function ws(p: any, who = "owner", epoch = 1) {
  const f = p.data.files[0],
    u = people[who],
    messages: any[] = [];
  const socket = new WebSocket(
    `ws://127.0.0.1:3100/api/projects/${p.id}/documents/${f.id}/ws?epoch=${epoch}&schema=1&clientId=${Math.floor(Math.random() * 1e9)}`,
    { headers: { cookie: "qollab=" + u.raw, origin: config.origin } },
  );
  sockets.push(socket);
  socket.on("message", (m) => messages.push(JSON.parse(m.toString())));
  const take = async (type: string) => {
    for (let n = 0; n < 300; n++) {
      const i = messages.findIndex((m) => m.type === type);
      if (i >= 0) return messages.splice(i, 1)[0];
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("No " + type + JSON.stringify(messages));
  };
  await new Promise<void>((r, j) => {
    socket.on("open", () => r());
    socket.on("error", j);
  });
  return { socket, take, messages };
}
beforeAll(async () => {
  app = await createApp({ logger: false });
  await pool.query(
    "TRUNCATE projects,users,sessions,oidc_states,updates,checkpoints,restores,builds,members,invites,audit CASCADE",
  );
  for (const name of ["owner", "editor", "viewer"]) {
    const raw = token(),
      csrf = token();
    people[name] = { id: name, raw, csrf };
    await pool.query("INSERT INTO users VALUES($1,$2,$3)", [
      name,
      name + "@example.com",
      name,
    ]);
    await pool.query(
      "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '1 day')",
      [hash(raw), name, csrf],
    );
  }
  await app.listen({ host: "127.0.0.1", port: 3100 });
});
afterAll(async () => {
  for (const ws of sockets) ws.terminate();
  await app.close();
  await pool.end();
});
it("exposes no bypass login and enforces Origin, CSRF and viewer on every write", async () => {
  expect((await app.inject("/api/session")).json().user).toBeNull();
  expect((await app.inject("/api/auth/google")).statusCode).toBe(503);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/projects",
        headers: { cookie: "qollab=" + people.owner.raw },
        payload: { name: "bad" },
      })
    ).statusCode,
  ).toBe(403);
  const p = await project();
  await pool.query("INSERT INTO members VALUES($1,'viewer','viewer')", [p.id]);
  expect(
    (
      await request("viewer", `/projects/${p.id}/files`, "POST", {
        revision: p.revision,
        path: "x.qmd",
      })
    ).statusCode,
  ).toBe(403);
  expect((await request("editor", `/projects/${p.id}/export`)).statusCode).toBe(
    404,
  );
  expect(() =>
    validateClaims(
      {
        sub: "x",
        email: "x@example.com",
        email_verified: true,
        hd: "evil",
      } as any,
      { workspace: "example.com", admission: "all", approved: [] },
    ),
  ).toThrow();
});
it("persists before ACK, merges two peers, reloads snapshots and revokes existing sockets", async () => {
  const p = await project();
  await pool.query("INSERT INTO members VALUES($1,'editor','editor')", [p.id]);
  const a = await ws(p),
    b = await ws(p, "editor");
  const sa = await a.take("sync"),
    sb = await b.take("sync");
  const da = new Y.Doc(),
    db = new Y.Doc();
  Y.applyUpdate(da, Buffer.from(sa.state, "base64"));
  Y.applyUpdate(db, Buffer.from(sb.state, "base64"));
  const ua: Uint8Array[] = [],
    ub: Uint8Array[] = [];
  da.on("update", (u) => ua.push(u));
  db.on("update", (u) => ub.push(u));
  (da.getXmlFragment("prosemirror").get(0) as Y.XmlElement)
    .get(0)!
    .insert(0, "Alice " as any);
  (db.getXmlFragment("prosemirror").get(0) as Y.XmlElement)
    .get(0)!
    .insert(0, "한글 " as any);
  const aid = randomUUID(),
    bid = randomUUID();
  a.socket.send(
    JSON.stringify({
      type: "update",
      id: aid,
      update: Buffer.from(ua[0]).toString("base64"),
    }),
  );
  b.socket.send(
    JSON.stringify({
      type: "update",
      id: bid,
      update: Buffer.from(ub[0]).toString("base64"),
    }),
  );
  await a.take("ack");
  await b.take("ack");
  const saved = (await request("owner", `/projects/${p.id}`)).json();
  expect(saved.data.files[0].source).toContain("Alice");
  expect(saved.data.files[0].source).toContain("한글");
  const persisted = await pool.query("SELECT data FROM projects WHERE id=$1", [
    p.id,
  ]);
  expect(persisted.rows[0].data.files[0].state).toBeTruthy();
  const c = await ws(saved);
  const resumed = await c.take("sync");
  expect(resumed.state).toBe(persisted.rows[0].data.files[0].state);
  const revocation = await request(
    "owner",
    `/projects/${p.id}/members/editor`,
    "PATCH",
    { revision: saved.revision, role: "viewer" },
  );
  expect(revocation.statusCode, revocation.body).toBe(200);
  const d = await ws(saved, "editor");
  await d.take("sync");
  d.socket.send(
    JSON.stringify({
      type: "update",
      id: randomUUID(),
      update: Buffer.from(ub[0]).toString("base64"),
    }),
  );
  expect((await d.take("error")).code).toBe("FORBIDDEN");
  da.destroy();
  db.destroy();
});
it("uploads valid images idempotently, rejects invalid images and protects references", async () => {
  const p = await project(),
    bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#237f79" },
    })
      .png()
      .toBuffer(),
    upload = {
      revision: 0,
      uploadId: randomUUID(),
      name: "small.png",
      bytes: bytes.toString("base64"),
      documentId: p.data.files[0].id,
    };
  const a = await request("owner", `/projects/${p.id}/images`, "POST", upload);
  expect(a.statusCode, a.body).toBe(200);
  const b = await request("owner", `/projects/${p.id}/images`, "POST", upload);
  expect(b.json().result.file.id).toBe(a.json().result.file.id);
  const bad = await request("owner", `/projects/${p.id}/images`, "POST", {
    ...upload,
    uploadId: randomUUID(),
    bytes: Buffer.from("not image").toString("base64"),
  });
  expect(bad.statusCode).toBe(400);
  let current = (await request("owner", `/projects/${p.id}`)).json();
  const create = await request("owner", `/projects/${p.id}/files`, "POST", {
    revision: current.revision,
    path: "chapters/second.qmd",
    source: `![Picture](../${a.json().result.file.path})`,
  });
  expect(create.statusCode, create.body).toBe(200);
  const del = await request(
    "owner",
    `/projects/${p.id}/files/${a.json().result.file.id}`,
    "DELETE",
    { revision: create.json().revision },
  );
  expect(del.json().code).toBe("REFERENCED_FILE");
  const zip = await request("owner", `/projects/${p.id}/export`);
  const imported = await request("owner", "/import", "POST", {
    name: "Imported",
    bytes: zip.rawPayload.toString("base64"),
  });
  expect(imported.statusCode, imported.body).toBe(200);
  const copied = (
    await request("owner", `/projects/${imported.json().id}`)
  ).json();
  expect(copied.data.files.map((f: any) => f.path)).toEqual(
    current.data.files.map((f: any) => f.path).concat("chapters/second.qmd"),
  );
});
it("restores documents/assets with fresh generations while preserving members and rejecting old writes", async () => {
  const p = await project();
  await pool.query("INSERT INTO members VALUES($1,'viewer','viewer')", [p.id]);
  const history = (await request("owner", `/projects/${p.id}/history`)).json();
  const a = await ws(p);
  await a.take("sync");
  const raw = await request(
    "owner",
    `/projects/${p.id}/files/${p.data.files[0].id}/raw`,
    "POST",
    { revision: p.revision },
  );
  expect(raw.statusCode, raw.body).toBe(200);
  const changed = await request(
    "owner",
    `/projects/${p.id}/files/${p.data.files[0].id}/raw`,
    "PUT",
    {
      revision: raw.json().revision,
      epoch: raw.json().result.epoch,
      rawVersion: raw.json().result.rawVersion,
      source: "# Changed",
      visual: true,
    },
  );
  expect(changed.statusCode, changed.body).toBe(200);
  const restored = await request(
    "owner",
    `/projects/${p.id}/history/${history[0].id}/restore`,
    "POST",
    { revision: changed.json().revision },
  );
  expect(restored.statusCode, restored.body).toBe(200);
  const now = (await request("owner", `/projects/${p.id}`)).json();
  expect(now.data.files[0].id).toBe(p.data.files[0].id);
  expect(now.data.files[0].source).toBe("# Untitled\n\n");
  expect(now.data.files[0].epoch).toBeGreaterThan(p.data.files[0].epoch);
  expect((await request("viewer", `/projects/${p.id}`)).statusCode).toBe(200);
  const old = await ws(p);
  expect((await old.take("error")).code).toBe("STALE_DOCUMENT");
});
it("prevents removing last owner; accepts single-use targeted invitations", async () => {
  const p = await project();
  expect(
    (
      await request("owner", `/projects/${p.id}/members/owner`, "PATCH", {
        revision: 0,
        role: "viewer",
      })
    ).json().code,
  ).toBe("LAST_OWNER");
  const invite = await request("owner", `/projects/${p.id}/invites`, "POST", {
    revision: 0,
    email: "editor@example.com",
    role: "editor",
  });
  const tok = new URL(invite.json().result.url).searchParams.get("invite");
  expect(
    (await request("viewer", "/invites/accept", "POST", { token: tok }))
      .statusCode,
  ).toBe(404);
  expect(
    (await request("editor", "/invites/accept", "POST", { token: tok }))
      .statusCode,
  ).toBe(200);
  expect(
    (await request("editor", "/invites/accept", "POST", { token: tok }))
      .statusCode,
  ).toBe(404);
});
it("keeps last good PDF on failure and rejects stale leased results", async () => {
  const p = await project();
  const submit = async (pdf?: string) => {
    await pool.query(
      "UPDATE builds SET status='cancelled' WHERE status IN ('queued','running')",
    );
    const id = randomUUID(),
      lease = randomUUID();
    await pool.query(
      "INSERT INTO builds(id,project_id,revision,epoch,target,status,input,lease,lease_until) VALUES($1,$2,$3,$4,'report.qmd','running','{}',$5,now()+interval '1 minute')",
      [id, p.id, Number(p.revision), p.data.epoch, lease],
    );
    const r = await app.inject({
      method: "POST",
      url: `/api/renderer/builds/${id}/result`,
      headers: { authorization: "Bearer " + config.rendererToken },
      payload: {
        lease,
        pdf,
        log: pdf ? "OK" : "TEST_FAILURE",
        image: "test@sha256:123",
      },
    });
    return { r, id, lease };
  };
  const good = await submit(
    Buffer.from("%PDF-1.7\nfixture").toString("base64"),
  );
  expect(good.r.statusCode, good.r.body).toBe(200);
  const bad = await submit();
  expect(bad.r.statusCode).toBe(200);
  const now = (await request("owner", `/projects/${p.id}`)).json();
  expect(now.data.pdfBuild).toBe(good.id);
  const duplicate = await app.inject({
    method: "POST",
    url: `/api/renderer/builds/${good.id}/result`,
    headers: { authorization: "Bearer " + config.rendererToken },
    payload: { lease: good.lease, log: "late", image: "test" },
  });
  expect(duplicate.statusCode).toBe(409);
});
it("freezes all writes for a coherent backup and recovers the committed mirror journal", async () => {
  const p = await project();
  const admin = { authorization: "Bearer " + config.adminToken };
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/admin/freeze",
        headers: admin,
        payload: { frozen: true, backupId: "test-backup" },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await request("owner", "/projects", "POST", { name: "blocked" }))
      .statusCode,
  ).toBe(503);
  await app.inject({
    method: "POST",
    url: "/api/admin/freeze",
    headers: admin,
    payload: { frozen: false },
  });
  const { recover } = await import("../apps/server/src/store.js");
  await pool.query("UPDATE checkpoints SET git_hash=NULL WHERE project_id=$1", [
    p.id,
  ]);
  await recover();
  const cp = await pool.query(
    "SELECT git_hash FROM checkpoints WHERE project_id=$1",
    [p.id],
  );
  expect(cp.rows[0].git_hash).toMatch(/^[0-9a-f]{40}$/);
});
it("renames preserve document IDs and rewrite known relative image references", async () => {
  const p = await project();
  let r = await request("owner", `/projects/${p.id}/files`, "POST", {
    revision: 0,
    path: "chapters/a.qmd",
    source: "![Image](../assets/a.png)\n",
  });
  expect(r.statusCode).toBe(200);
  const doc = r.json().result;
  r = await request("owner", `/projects/${p.id}/files/${doc.id}`, "PATCH", {
    revision: r.json().revision,
    path: "parts/deep/a.qmd",
  });
  expect(r.statusCode, r.body).toBe(200);
  expect(r.json().result.id).toBe(doc.id);
  expect(r.json().result.source).toBe("![Image](../../assets/a.png)\n");
});
it("never reuses a generation after deleting and restoring the same document twice", async () => {
  const p = await project(),
    history = (await request("owner", `/projects/${p.id}/history`)).json(),
    cid = history[0].id;
  let revision = 0,
    epoch = 1;
  for (let n = 0; n < 2; n++) {
    const del = await request(
      "owner",
      `/projects/${p.id}/files/${p.data.files[0].id}`,
      "DELETE",
      { revision },
    );
    expect(del.statusCode, del.body).toBe(200);
    revision = del.json().revision;
    const restore = await request(
      "owner",
      `/projects/${p.id}/history/${cid}/restore`,
      "POST",
      { revision },
    );
    expect(restore.statusCode, restore.body).toBe(200);
    revision = restore.json().revision;
    const now = (await request("owner", `/projects/${p.id}`)).json();
    expect(now.data.files[0].epoch).toBeGreaterThan(epoch);
    epoch = now.data.files[0].epoch;
  }
});
it("late results cannot replace a newer PDF or cross a project restore epoch", async () => {
  const p = await project(),
    newer = randomUUID(),
    older = randomUUID(),
    lease = randomUUID();
  for (const [id, revision] of [
    [newer, 9],
    [older, 8],
  ])
    await pool.query(
      "INSERT INTO builds(id,project_id,revision,epoch,target,status,input,lease,lease_until) VALUES($1,$2,$3,1,'report.qmd','running','{}',$4,now()+interval '1 minute')",
      [id, p.id, revision, lease],
    );
  async function result(id: string) {
    return app.inject({
      method: "POST",
      url: `/api/renderer/builds/${id}/result`,
      headers: { authorization: "Bearer " + config.rendererToken },
      payload: {
        lease,
        pdf: Buffer.from("%PDF-1.7\nfixture").toString("base64"),
        log: "ok",
        image: "test",
      },
    });
  }
  expect((await result(newer)).statusCode).toBe(200);
  expect((await result(older)).statusCode).toBe(200);
  expect(
    (await request("owner", `/projects/${p.id}`)).json().data.pdfBuild,
  ).toBe(newer);
});
it("scopes renderer reference caches to project, restore and document generations", async () => {
  const p = await project(),
    other = await project();
  async function key(id: string) {
    await pool.query(
      "UPDATE builds SET status='cancelled' WHERE status IN ('queued','running')",
    );
    const current = (await request("owner", `/projects/${id}`)).json();
    const queued = await request("owner", `/projects/${id}/builds`, "POST", {
      revision: Number(current.revision),
    });
    expect(queued.statusCode, queued.body).toBe(200);
    const leased = await app.inject({
      method: "POST",
      url: "/api/renderer/lease",
      headers: { authorization: "Bearer " + config.rendererToken },
      payload: {},
    });
    expect(leased.statusCode, leased.body).toBe(200);
    expect(leased.json().cacheKey).toMatch(/^[a-f0-9]{64}$/);
    return leased.json().cacheKey;
  }
  const first = await key(p.id);
  expect(await key(p.id)).toBe(first);
  expect(await key(other.id)).not.toBe(first);
  const current = (await request("owner", `/projects/${p.id}`)).json();
  const raw = await request(
    "owner",
    `/projects/${p.id}/files/${p.data.files[0].id}/raw`,
    "POST",
    { revision: Number(current.revision) },
  );
  expect(raw.statusCode, raw.body).toBe(200);
  const next = await key(p.id);
  expect(next).not.toBe(first);
  await pool.query(
    "UPDATE projects SET data=jsonb_set(data,'{epoch}',to_jsonb((data->>'epoch')::int+1)) WHERE id=$1",
    [p.id],
  );
  expect(await key(p.id)).not.toBe(next);
  await pool.query(
    "UPDATE builds SET status='cancelled' WHERE status IN ('queued','running')",
  );
});
