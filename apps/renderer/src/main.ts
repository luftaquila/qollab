import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const base = process.env.APP_URL || "http://app:3000",
  secret = process.env.RENDERER_TOKEN;
const image =
  process.env.RENDER_IMAGE || "ghcr.io/luftaquila/qollab-renderer:0.1.3";
const engine = process.env.CONTAINER_ENGINE || "docker",
  namespace = process.env.RENDERER_NAMESPACE || "qollab";
if (!secret || secret.length < 32)
  throw new Error("RENDERER_TOKEN must contain at least 32 characters");
const headers = {
  Authorization: "Bearer " + secret,
  "Content-Type": "application/json",
};
let stopped = false,
  active: string | undefined;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const r = await fetch(base + "/api/renderer" + path, {
    method,
    headers: { ...headers, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Renderer API ${r.status}`);
  const reader = r.body!.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 360 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("INPUT_LIMIT");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function cleanup() {
  const { stdout } = await exec(engine, [
    "ps",
    "-aq",
    "--filter",
    `label=io.qollab.renderer=${namespace}`,
  ]);
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  for (const id of ids) await exec(engine, ["rm", "-f", id]).catch(() => {});
}
async function run(
  job: any,
  input: any,
): Promise<{ pdf?: string; log: string; metrics?: Record<string, number> }> {
  const started = performance.now();
  const args = [
    "create",
    "-i",
    "--label",
    `io.qollab.renderer=${namespace}`,
    "--label",
    `io.qollab.job=${job.id}`,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    "10001:10001",
    "--cpus",
    process.env.RENDER_CPUS || "1",
    "--memory",
    process.env.RENDER_MEMORY || "2g",
    "--pids-limit",
    process.env.RENDER_PIDS || "64",
    "--tmpfs",
    `/work:rw,nosuid,nodev,mode=1777,size=${process.env.RENDER_TMPFS || "512m"}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,mode=1777,size=32m",
    "--env",
    "HOME=/work",
    "--env",
    "TEXMFVAR=/work/.texlive",
    "--env",
    "openin_any=p",
    "--env",
    "openout_any=p",
    "--env",
    "shell_escape=f",
    "--workdir",
    "/work",
    image,
    "python3",
    "/opt/qollab/render.py",
  ];
  const { stdout } = await exec(engine, args);
  const created = performance.now();
  const id = stdout.trim();
  active = id;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(engine, ["start", "-ai", id], {
          stdio: ["pipe", "pipe", "pipe"],
        }),
        out: Buffer[] = [];
      let size = 0,
        log = "",
        expired = false;
      let cancelling = false;
      const monitor = setInterval(() => {
        if (cancelling) return;
        void request(`/builds/${job.id}/status`, "GET", undefined, {
          "x-render-lease": job.lease,
        }).catch(() => {
          cancelling = true;
          void exec(engine, ["rm", "-f", id]);
        });
      }, 2000);
      const timer = setTimeout(() => {
        expired = true;
        void exec(engine, ["rm", "-f", id]);
      }, job.timeout * 1000);
      child.stdout.on("data", (b: Buffer) => {
        size += b.length;
        if (size > 72 * 1024 * 1024) {
          expired = true;
          void exec(engine, ["rm", "-f", id]);
        } else out.push(b);
      });
      child.stderr.on("data", (b: Buffer) => {
        log = (log + b.toString()).slice(-60000);
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        clearInterval(monitor);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        clearInterval(monitor);
        if (expired) return resolve({ log: "RENDER_TIMEOUT_OR_OUTPUT_LIMIT" });
        if (code !== 0) return resolve({ log: log || `Renderer exit ${code}` });
        try {
          const result = JSON.parse(Buffer.concat(out).toString());
          console.info(
            JSON.stringify({
              type: "render-timing",
              build: job.id,
              createMs: Math.round(created - started),
              executionMs: Math.round(performance.now() - created),
              worker: result.metrics,
              succeeded: !!result.pdf,
            }),
          );
          resolve(result);
        } catch {
          resolve({ log: "INVALID_RENDER_OUTPUT\n" + log });
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(
        JSON.stringify({ ...input, target: job.target, timeout: job.timeout }),
      );
    });
  } finally {
    await exec(engine, ["rm", "-f", id]).catch(() => {});
    active = undefined;
  }
}
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    stopped = true;
    void (
      active ? exec(engine, ["rm", "-f", active]) : Promise.resolve()
    ).finally(() => process.exit(0));
  });
await cleanup();
while (!stopped) {
  try {
    const job = await request("/lease", "POST", {});
    if (job) {
      let result;
      try {
        const input = await request(
          `/builds/${job.id}/input`,
          "GET",
          undefined,
          { "x-render-lease": job.lease },
        );
        result = await run(job, input);
      } catch (e) {
        result = { log: String(e).slice(0, 60000) };
      }
      await request(`/builds/${job.id}/result`, "POST", {
        ...result,
        lease: job.lease,
        image,
      });
      continue;
    }
  } catch (e) {
    console.error(String(e));
  }
  await new Promise((r) => setTimeout(r, 1000));
}
