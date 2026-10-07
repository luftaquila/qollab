import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";

const engine = process.env.COMPOSE_ENGINE || "docker",
  origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000";
function command(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.stdin.end(input);
    child.on("exit", (code) =>
      code ? reject(new Error(stderr || stdout)) : resolve(stdout),
    );
    child.on("error", reject);
  });
}
const id = randomUUID(),
  raw = randomUUID(),
  csrf = randomUUID(),
  headers = {
    cookie: "qollab=" + raw,
    origin,
    "x-csrf-token": csrf,
    "content-type": "application/json",
  };
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Application failed to start");
}
async function api(path, method = "GET", body) {
  const r = await fetch(origin + "/api" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
await ready();
await command(
  engine,
  [
    "compose",
    "exec",
    "-T",
    "database",
    "psql",
    "-U",
    "qollab",
    "-d",
    "qollab",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  `INSERT INTO users VALUES ('${id}','deployment@example.com','Deployment test'); INSERT INTO sessions VALUES ('${createHash("sha256").update(raw).digest("hex")}','${id}','${csrf}',now()+interval '1 hour');`,
);
const p = await api("/projects", "POST", { name: "Deployment verification" }),
  path = "/projects/" + p.id;
let project = await api(path);
const fid = project.data.files[0].id;
const image = await readFile(
  new URL("../tests/fixtures/figure.png", import.meta.url),
);
const uploaded = await api(path + "/images", "POST", {
  revision: 0,
  uploadId: randomUUID(),
  name: "figure.png",
  bytes: image.toString("base64"),
  documentId: fid,
});
project = await api(path);
const rawMode = await api(path + "/files/" + fid + "/raw", "POST", {
  revision: Number(project.revision),
});
await api(path + "/files/" + fid + "/raw", "PUT", {
  revision: rawMode.revision,
  epoch: rawMode.result.epoch,
  rawVersion: rawMode.result.rawVersion,
  visual: true,
  source: `# 배포 검증\n\n한글 문서와 이미지입니다.\n\n$$E=mc^2$$\n\n| A | B |\n|---|---|\n| 표 | 검증 |\n\n![그림](${uploaded.result.relative}){width=30%}\n`,
});
const started = performance.now();
for (let i = 0; i < 180; i++) {
  const builds = await api(path + "/builds");
  if (builds[0]?.status === "failed") throw new Error(builds[0].log);
  if (builds[0]?.status === "succeeded") break;
  if (i === 179) throw new Error("Render did not finish");
  await new Promise((r) => setTimeout(r, 1000));
}
project = await api(path);
await api(path + "/history", "POST", {
  revision: Number(project.revision),
  label: "Deployment checkpoint",
});
const snapshot = {
  project: await api(path),
  history: await api(path + "/history"),
  members: await api(path + "/members"),
};
await mkdir("tmp", { recursive: true });
const pdf = await fetch(origin + "/api" + path + "/pdf", { headers });
await writeFile("tmp/deployment.pdf", Buffer.from(await pdf.arrayBuffer()));
const backup = "tmp/backup-" + id;
await command("bash", ["scripts/backup.sh", backup]);
// Change durable state after backup, then prove restore returns every tested class.
await api(path + "/files", "POST", {
  revision: Number(snapshot.project.revision),
  path: "after-backup.qmd",
  source: "# After backup",
});
await command("bash", ["scripts/restore.sh", backup]);
await ready();
const restored = {
  project: await api(path),
  history: await api(path + "/history"),
  members: await api(path + "/members"),
};
if (JSON.stringify(restored) !== JSON.stringify(snapshot))
  throw new Error("Backup differs after restore");
const asset = await fetch(
  origin + "/api" + path + "/files/" + uploaded.result.file.id,
  { headers },
);
if (!Buffer.from(await asset.arrayBuffer()).equals(image))
  throw new Error("Image differs after restore");
await writeFile(
  "tmp/deployment-session.json",
  JSON.stringify({ raw, csrf, project: p.id, name: "Deployment verification" }),
  { mode: 0o600 },
);
const report = {
  engine,
  renderAndBackupSeconds: Math.round((performance.now() - started) / 1000),
  project: p.id,
  backup,
  document: true,
  image: true,
  members: true,
  history: true,
  pdf: true,
};
await writeFile("tmp/deployment-report.json", JSON.stringify(report, null, 2));
console.log(report);
