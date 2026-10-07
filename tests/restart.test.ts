import { it, expect } from "vitest";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";
import * as Y from "yjs";
import { WebSocket } from "ws";
it("recovers acknowledged changes and finishes a restore interrupted after DB commit", async () => {
  const id = randomUUID(),
    root = resolve(".data/restart-" + id),
    bin = root + "/bin",
    pause = root + "/pause",
    db = new pg.Pool({ connectionString: process.env.DATABASE_URL }),
    raw = randomUUID(),
    csrf = randomUUID(),
    uid = "restart-" + id,
    port = 3102;
  await mkdir(bin, { recursive: true });
  const git = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  await writeFile(
    bin + "/git",
    `#!/bin/sh\nif [ -f "$QOLLAB_TEST_GIT_PAUSE" ]; then while [ -f "$QOLLAB_TEST_GIT_PAUSE" ]; do sleep 1; done; fi\nexec '${git}' "$@"\n`,
    { mode: 0o700 },
  );
  let child: ChildProcess | undefined,
    log = "";
  const sockets: WebSocket[] = [];
  async function start() {
    child = spawn(
      process.execPath,
      ["--import", "tsx", "apps/server/src/main.ts"],
      {
        env: {
          ...process.env,
          PORT: String(port),
          PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
          DATA_DIR: root,
          PATH: bin + ":" + process.env.PATH,
          QOLLAB_TEST_GIT_PAUSE: pause,
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout!.on("data", (b) => (log = (log + b).slice(-6000)));
    child.stderr!.on("data", (b) => (log = (log + b).slice(-6000)));
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(log);
  }
  async function kill() {
    if (child?.pid) {
      process.kill(-child.pid, "SIGKILL");
      await new Promise((r) => child!.once("exit", r));
      child = undefined;
    }
  }
  async function api(path: string, method = "GET", body?: unknown) {
    const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        cookie: "qollab=" + raw,
        origin: `http://127.0.0.1:${port}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(r.ok, await r.clone().text()).toBe(true);
    return r.json();
  }
  try {
    await start();
    await db.query("INSERT INTO users VALUES($1,$2,$3)", [
      uid,
      uid + "@example.com",
      "Restart",
    ]);
    await db.query(
      "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '1 hour')",
      [createHash("sha256").update(raw).digest("hex"), uid, csrf],
    );
    const p = await api("/projects", "POST", { name: "Crash recovery" }),
      initial = await api("/projects/" + p.id),
      fid = initial.data.files[0].id;
    const history = await api(`/projects/${p.id}/history`);
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/projects/${p.id}/documents/${fid}/ws?epoch=1&schema=1&clientId=42`,
      {
        headers: {
          cookie: "qollab=" + raw,
          origin: `http://127.0.0.1:${port}`,
        },
      },
    );
    sockets.push(socket);
    const messages: any[] = [];
    socket.on("message", (b) => messages.push(JSON.parse(b.toString())));
    async function take(type: string) {
      for (let n = 0; n < 300; n++) {
        const i = messages.findIndex((m) => m.type === type);
        if (i >= 0) return messages.splice(i, 1)[0];
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("No " + type);
    }
    const sync = await take("sync"),
      doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(sync.state, "base64"));
    let update: Uint8Array | undefined;
    doc.on("update", (u) => (update = u));
    const text = (doc.getXmlFragment("prosemirror").get(0) as Y.XmlElement).get(
      0,
    ) as Y.XmlText;
    text.insert(0, "Durable ");
    socket.send(
      JSON.stringify({
        type: "update",
        id: randomUUID(),
        update: Buffer.from(update!).toString("base64"),
      }),
    );
    await take("ack");
    await kill();
    doc.destroy();
    await start();
    const persisted = await api("/projects/" + p.id);
    expect(persisted.data.files[0].source).toContain("Durable");
    await writeFile(pause, "pause");
    const pending = api(
      `/projects/${p.id}/history/${history[0].id}/restore`,
      "POST",
      { revision: Number(persisted.revision) },
    ).catch(() => null);
    for (let n = 0; n < 100; n++) {
      const jobs = await db.query(
        "SELECT status FROM restores WHERE project_id=$1",
        [p.id],
      );
      if (jobs.rows[0]?.status === "committed") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const jobs = await db.query(
      "SELECT status FROM restores WHERE project_id=$1",
      [p.id],
    );
    expect(jobs.rows[0].status).toBe("committed");
    await kill();
    await pending;
    await rm(pause);
    await start();
    const restored = await api("/projects/" + p.id);
    expect(restored.data.files[0].source).toBe(initial.data.files[0].source);
    expect(restored.data.files[0].epoch).toBeGreaterThan(1);
    expect(
      (
        await db.query("SELECT status FROM restores WHERE project_id=$1", [
          p.id,
        ])
      ).rows[0].status,
    ).toBe("complete");
  } finally {
    for (const socket of sockets) socket.terminate();
    await kill();
    await db.end();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
