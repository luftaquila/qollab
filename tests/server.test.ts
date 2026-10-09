import { beforeAll, afterAll, it, expect } from "vitest";
import { SCHEMA_VERSION } from "../packages/codec/src/index.js";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import * as Y from "yjs";
import sharp from "sharp";
import { createApp } from "../apps/server/src/app.js";
import { pool } from "../apps/server/src/db.js";
import { token, hash, validateClaims } from "../apps/server/src/auth.js";
import { config } from "../apps/server/src/config.js";
import { subscribe } from "../apps/server/src/store.js";
import { blobId, migrateBlobs } from "../apps/server/src/blobs.js";
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
    `ws://127.0.0.1:3100/api/projects/${p.id}/documents/${f.id}/ws?epoch=${epoch}&schema=${SCHEMA_VERSION}&clientId=${Math.floor(Math.random() * 1e9)}`,
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
it("keeps only Google profile photo URLs from identity claims", () => {
  const claims = (picture: unknown) =>
    validateClaims(
      { sub: "p", email: "p@example.com", email_verified: true, picture } as any,
      { workspace: undefined, admission: "all", approved: [] },
    ).picture;
  expect(claims("https://lh3.googleusercontent.com/a/abc=s96-c")).toBe(
    "https://lh3.googleusercontent.com/a/abc=s96-c",
  );
  expect(claims("https://evil.example.com/a.png")).toBeNull();
  expect(claims("http://lh3.googleusercontent.com/a/abc")).toBeNull();
  expect(claims("javascript:alert(1)")).toBeNull();
  expect(claims(undefined)).toBeNull();
});
it("reports editor activity to the authenticated renderer and clears it on close", async () => {
  const activity = () =>
    app.inject({
      url: "/api/renderer/activity",
      headers: { authorization: "Bearer " + config.rendererToken },
    });
  expect((await app.inject("/api/renderer/activity")).statusCode).toBe(403);
  const p = await project();
  await pool.query("INSERT INTO members VALUES($1,'viewer','viewer')", [p.id]);
  const viewer = await ws(p, "viewer");
  await viewer.take("sync");
  expect((await activity()).json().editing).toBe(false);
  const owner = await ws(p);
  await owner.take("sync");
  expect((await activity()).json().editing).toBe(true);
  owner.socket.terminate();
  await expect.poll(async () => (await activity()).json().editing).toBe(false);
  viewer.socket.terminate();
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
it("keeps images in blobs, serves them and gives the renderer only the blobs of its build", async () => {
  await pool.query(
    "UPDATE builds SET status='cancelled' WHERE status IN ('queued','running')",
  );
  const p = await project(),
    bytes = await sharp({
      create: { width: 6, height: 6, channels: 3, background: "#1c7667" },
    })
      .png()
      .toBuffer();
  const up = await request("owner", `/projects/${p.id}/images`, "POST", {
    revision: 0,
    uploadId: randomUUID(),
    name: "blob.png",
    bytes: bytes.toString("base64"),
  });
  expect(up.statusCode, up.body).toBe(200);
  const stored = (
    await pool.query("SELECT data FROM projects WHERE id=$1", [p.id])
  ).rows[0].data.files.find((f: any) => f.kind === "image");
  expect(stored.bytes).toBeUndefined();
  expect(stored.blob).toBe(blobId(bytes));
  expect(stored.size).toBe(bytes.length);
  expect(up.json().result.file.blob).toBeUndefined();
  const served = await request(
    "owner",
    `/projects/${p.id}/resource?path=${encodeURIComponent(stored.path)}`,
  );
  expect(Buffer.compare(served.rawPayload, bytes)).toBe(0);
  // The build input names the blob; the renderer fetches it with its lease.
  await request("owner", `/projects/${p.id}/builds`, "POST", {
    revision: up.json().revision,
  });
  const renderer = { authorization: "Bearer " + config.rendererToken };
  const job = (
    await app.inject({ method: "POST", url: "/api/renderer/lease", headers: renderer })
  ).json();
  expect(job.project).toBe(p.id);
  const lease = { ...renderer, "x-render-lease": job.lease };
  const input = (
    await app.inject({ url: `/api/renderer/builds/${job.id}/input`, headers: lease })
  ).json();
  const image = input.files.find((f: any) => f.path === stored.path);
  expect(image).toEqual({ path: stored.path, blob: stored.blob });
  const blob = await app.inject({
    url: `/api/renderer/builds/${job.id}/blobs/${stored.blob}`,
    headers: lease,
  });
  expect(Buffer.compare(blob.rawPayload, bytes)).toBe(0);
  const other = await app.inject({
    url: `/api/renderer/builds/${job.id}/blobs/${"0".repeat(64)}`,
    headers: lease,
  });
  expect(other.statusCode).toBe(404);
  await pool.query("UPDATE builds SET status='cancelled' WHERE id=$1", [job.id]);
  // Projects saved before blobs: the images move out on startup.
  const legacy = randomUUID();
  await pool.query("INSERT INTO projects(id,name,data) VALUES($1,'Legacy',$2)", [
    legacy,
    {
      epoch: 1,
      target: "",
      files: [
        { id: randomUUID(), path: "a.png", kind: "image", mime: "image/png", epoch: 1, bytes: bytes.toString("base64") },
      ],
    },
  ]);
  await migrateBlobs();
  const moved = (
    await pool.query("SELECT data FROM projects WHERE id=$1", [legacy])
  ).rows[0].data.files[0];
  expect(moved).toMatchObject({ blob: blobId(bytes), size: bytes.length });
  expect(moved.bytes).toBeUndefined();
  await pool.query("DELETE FROM projects WHERE id=$1", [legacy]);
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
  const notifications: any[] = [];
  const committedReads: Promise<string | undefined>[] = [];
  const unsubscribe = subscribe(p.id, (event: any) => {
    notifications.push(event);
    committedReads.push(
      pool
        .query("SELECT data FROM projects WHERE id=$1", [p.id])
        .then((r) => r.rows[0].data.pdfBuild),
    );
  });
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
  unsubscribe();
  expect(notifications).toEqual([
    { type: "build", epoch: 1, pdfBuild: good.id, pdfRevision: 0 },
    { type: "build", epoch: 1, pdfBuild: good.id, pdfRevision: 0 },
  ]);
  expect(await Promise.all(committedReads)).toEqual([good.id, good.id]);
});
it("coalesces edits and leases only the final snapshot after its quiet period", async () => {
  await pool.query(
    "UPDATE builds SET status='cancelled' WHERE status IN ('queued','running')",
  );
  expect(config.debounce).toBe(800);
  const p = await project();
  const url = `/projects/${p.id}/files/${p.data.files[0].id}/raw`;
  let edit = (await request("owner", url, "POST", { revision: 0 })).json();
  for (const source of ["# First\n", "# Second\n", "# Final\n"]) {
    const response = await request("owner", url, "PUT", {
      revision: edit.revision,
      epoch: edit.result.epoch,
      rawVersion: edit.result.rawVersion,
      source,
    });
    expect(response.statusCode, response.body).toBe(200);
    edit = response.json();
  }
  const queued = await pool.query("SELECT * FROM builds WHERE project_id=$1", [
    p.id,
  ]);
  expect(queued.rows).toHaveLength(1);
  expect(queued.rows[0].input.files[0].source).toBe("# Final\n");
  const lease = () =>
    app.inject({
      method: "POST",
      url: "/api/renderer/lease",
      headers: { authorization: "Bearer " + config.rendererToken },
    });
  expect((await lease()).json()).toBeNull();
  // Wait to just before the actual DB deadline; the earlier edits must not
  // make the latest snapshot eligible before its own quiet period expires.
  // Time left is measured by the database clock, which decides the lease.
  const left = async () =>
    Number(
      (
        await pool.query(
          "SELECT extract(epoch FROM lease_until-now())*1000 AS ms FROM builds WHERE id=$1",
          [queued.rows[0].id],
        )
      ).rows[0].ms,
    );
  await new Promise(async (r) => setTimeout(r, Math.max(0, (await left()) - 300)));
  expect((await lease()).json()).toBeNull();
  await new Promise(async (r) => setTimeout(r, Math.max(0, (await left()) + 30)));
  const ready = (await lease()).json();
  expect(ready.id).toBe(queued.rows[0].id);
  expect(ready.revision).toBe(edit.revision);
  await pool.query("UPDATE builds SET status='cancelled' WHERE id=$1", [
    ready.id,
  ]);
});
it("stops a running build of older content when an edit queues a new one", async () => {
  const p = await project();
  const running = async (revision: number) => {
    const id = randomUUID(),
      lease = randomUUID();
    await pool.query(
      "INSERT INTO builds(id,project_id,revision,epoch,target,status,input,lease,lease_until) VALUES($1,$2,$3,1,'report.qmd','running','{}',$4,now()+interval '1 minute')",
      [id, p.id, revision, lease],
    );
    const status = () =>
      app.inject({
        method: "GET",
        url: `/api/renderer/builds/${id}/status`,
        headers: { authorization: "Bearer " + config.rendererToken, "x-render-lease": lease },
      });
    return { id, status };
  };
  // A rebuild of unchanged content leaves the running build alone.
  const current = await running(0);
  const rebuilt = await request("owner", `/projects/${p.id}/builds`, "POST", { revision: 0 });
  expect(rebuilt.statusCode, rebuilt.body).toBe(200);
  expect((await current.status()).statusCode).toBe(200);
  // An edit makes it stale: the renderer is told to stop.
  const url = `/projects/${p.id}/files/${p.data.files[0].id}/raw`;
  const edit = (await request("owner", url, "POST", { revision: rebuilt.json().revision })).json();
  const saved = await request("owner", url, "PUT", {
    revision: edit.revision,
    epoch: edit.result.epoch,
    rawVersion: edit.result.rawVersion,
    source: "# Changed\n",
  });
  expect(saved.statusCode, saved.body).toBe(200);
  expect((await current.status()).statusCode).toBe(409);
  const rows = await pool.query("SELECT id,status FROM builds WHERE project_id=$1", [p.id]);
  expect(rows.rows.find((r) => r.id === current.id).status).toBe("cancelled");
  expect(rows.rows.filter((r) => r.status === "queued")).toHaveLength(1);
  await pool.query("UPDATE builds SET status='cancelled' WHERE project_id=$1", [p.id]);
});
it("retains the displayed PDF through superseded results and publishes only current content", async () => {
  const p = await project();
  const notifications: any[] = [];
  const unsubscribe = subscribe(p.id, (event) => notifications.push(event));
  const finish = async (revision: number, target = "report.qmd", epoch = 1) => {
    const id = randomUUID(),
      lease = randomUUID();
    await pool.query(
      "INSERT INTO builds(id,project_id,revision,epoch,target,status,input,lease,lease_until) VALUES($1,$2,$3,$4,$5,'running','{}',$6,now()+interval '1 minute')",
      [id, p.id, revision, epoch, target, lease],
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/renderer/builds/${id}/result`,
      headers: { authorization: "Bearer " + config.rendererToken },
      payload: {
        lease,
        pdf: Buffer.from(`%PDF-1.7\nrevision ${revision}`).toString("base64"),
        log: "OK",
        image: "test",
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    return id;
  };
  const baseline = await finish(0);
  const url = `/projects/${p.id}/files/${p.data.files[0].id}/raw`;
  let edit = (await request("owner", url, "POST", { revision: 0 })).json();
  for (const source of ["# Intermediate\n", "# Final\n"]) {
    edit = (
      await request("owner", url, "PUT", {
        revision: edit.revision,
        epoch: edit.result.epoch,
        rawVersion: edit.result.rawVersion,
        source,
      })
    ).json();
  }
  const first = await finish(1),
    second = await finish(2);
  expect(
    (await request("owner", `/projects/${p.id}`)).json().data.pdfBuild,
  ).toBe(baseline);
  expect((await request("owner", `/projects/${p.id}/pdf`)).body).toContain(
    "revision 0",
  );
  // Unrelated checkpoints advance project revision without changing content.
  await request("owner", `/projects/${p.id}/history`, "POST", {
    revision: edit.revision,
    label: "Keep this content",
  });
  const current = await finish(edit.revision);
  await finish(edit.revision, "other.qmd");
  await finish(edit.revision, "report.qmd", 0);
  await finish(2); // delayed older result after the current one
  expect(
    (await request("owner", `/projects/${p.id}`)).json().data.pdfBuild,
  ).toBe(current);
  expect((await request("owner", `/projects/${p.id}/pdf`)).body).toContain(
    `revision ${edit.revision}`,
  );
  expect(
    (
      await pool.query("SELECT status FROM builds WHERE id=ANY($1::uuid[])", [
        [first, second],
      ])
    ).rows.every((r) => r.status === "succeeded"),
  ).toBe(true);
  expect(
    notifications.filter((e) => e.type === "build").map((e) => e.pdfBuild),
  ).toEqual([baseline, baseline, baseline, current, current, current, current]);
  unsubscribe();
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
it("signs visitors into one shared guest account only when anonymous access is enabled", async () => {
  const off = await app.inject("/api/session");
  expect(off.json()).toMatchObject({ user: null, anonymous: false });
  expect(off.headers["set-cookie"]).toBeUndefined();
  const cookie = (r: { headers: Record<string, unknown> }) =>
    /qollab=([^;]+)/.exec(String(r.headers["set-cookie"]))![1];
  config.anonymous = true;
  try {
    const first = await app.inject("/api/session"),
      second = await app.inject("/api/session"),
      a = first.json(),
      b = second.json();
    expect(a.user).toMatchObject({ id: "anonymous", name: "Guest" });
    expect(a.anonymous).toBe(true);
    expect(cookie(first)).not.toBe(cookie(second));
    expect(a.csrf).not.toBe(b.csrf);
    const headers = (r: typeof first, csrf?: string) => ({
      cookie: "qollab=" + cookie(r),
      origin: config.origin,
      ...(csrf ? { "x-csrf-token": csrf } : {}),
    });
    // Writes still need the session's CSRF token.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: headers(first),
          payload: { name: "Guest forged" },
        })
      ).statusCode,
    ).toBe(403);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: headers(first, a.csrf),
      payload: { name: "Guest shared" },
    });
    expect(created.statusCode, created.body).toBe(200);
    // Another visitor sees the same projects; logging out ends one session only.
    const listed = await app.inject({
      url: "/api/projects",
      headers: headers(second),
    });
    expect(listed.json().map((p: any) => p.id)).toContain(created.json().id);
    const out = await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: headers(first, a.csrf),
    });
    expect(out.statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/api/projects", headers: headers(second) }))
        .statusCode,
    ).toBe(200);
  } finally {
    config.anonymous = false;
  }
  expect((await app.inject("/api/session")).json().user).toBeNull();
});
it("lists projects by their last content change, not by access changes", async () => {
  const older = await project(),
    newer = await project();
  const listed = async () =>
    (await request("owner", "/projects")).json() as any[];
  const time = async (id: string) =>
    new Date((await listed()).find((p) => p.id === id).updated).getTime();
  const before = await time(older.id);
  expect(before).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 20));
  const p = (await request("owner", "/projects/" + older.id)).json();
  // A member change is not a content change.
  await pool.query(
    "INSERT INTO members VALUES($1,'viewer','viewer') ON CONFLICT DO NOTHING",
    [older.id],
  );
  const role = await request(
    "owner",
    `/projects/${older.id}/members/viewer`,
    "PATCH",
    { revision: Number(p.revision), role: "editor" },
  );
  expect(role.statusCode, role.body).toBe(200);
  expect(await time(older.id)).toBe(before);
  const added = await request("owner", `/projects/${older.id}/files`, "POST", {
    revision: Number(p.revision) + 1,
    path: "notes.qmd",
    source: "# Notes\n",
  });
  expect(added.statusCode, added.body).toBe(200);
  expect(await time(older.id)).toBeGreaterThan(before);
  const order = (await listed()).map((p) => p.id);
  expect(order.indexOf(older.id)).toBeLessThan(order.indexOf(newer.id));
  await pool.query(
    "UPDATE builds SET status='cancelled' WHERE status IN ('queued','running')",
  );
});
it("creates, renames and deletes folders atomically, rewriting references", async () => {
  const p = await project(),
    url = `/projects/${p.id}`;
  const current = async () => (await request("owner", url)).json();
  const call = async (path: string, method: string, body: any) => {
    const r = await request("owner", url + path, method, {
      revision: Number((await current()).revision),
      ...body,
    });
    return r;
  };
  const ok = async (r: Promise<any>) => {
    const response = await r;
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  await ok(call("/folders", "POST", { path: "chapters" }));
  expect((await current()).data.folders).toEqual(["chapters"]);
  expect((await call("/folders", "POST", { path: "chapters" })).statusCode).toBe(
    409,
  );
  const bytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#237f79" },
  })
    .png()
    .toBuffer();
  const image = await ok(
    call("/images", "POST", {
      uploadId: randomUUID(),
      name: "fig.png",
      bytes: bytes.toString("base64"),
    }),
  );
  const imagePath: string = image.result.file.path;
  expect(imagePath.startsWith("assets/images/")).toBe(true);
  await ok(
    call("/files", "POST", {
      path: "chapters/one.qmd",
      source: `# One\n\n![](../${imagePath})\n`,
    }),
  );
  const source = async (path: string) =>
    (await current()).data.files.find((f: any) => f.path === path)?.source;

  // Renaming the image folder updates links in documents elsewhere.
  await ok(call("/folders", "PATCH", { from: "assets", to: "media" }));
  const moved = imagePath.replace(/^assets\//, "media/");
  expect((await current()).data.files.some((f: any) => f.path === moved)).toBe(
    true,
  );
  expect(await source("chapters/one.qmd")).toContain(`](../${moved})`);
  // Moving a folder deeper updates its own documents' relative links.
  await ok(call("/folders", "PATCH", { from: "chapters", to: "parts/chapters" }));
  expect(await source("parts/chapters/one.qmd")).toContain(`](../../${moved})`);
  expect((await current()).data.folders).toEqual(["parts/chapters"]);
  expect(
    (await call("/folders", "PATCH", { from: "parts", to: "parts/inner" }))
      .statusCode,
  ).toBe(400);

  // A folder whose files are still referenced from outside is kept.
  const blocked = await call("/folders", "DELETE", { path: "media" });
  expect(blocked.statusCode).toBe(409);
  expect(blocked.json().code).toBe("REFERENCED_FILE");
  await ok(call("/folders", "DELETE", { path: "parts" }));
  await ok(call("/folders", "DELETE", { path: "media" }));
  const after = await current();
  expect(after.data.files.map((f: any) => f.path)).toEqual(["report.qmd"]);
  expect(after.data.folders).toEqual([]);
  await pool.query(
    "UPDATE builds SET status='cancelled' WHERE status IN ('queued','running')",
  );
});
