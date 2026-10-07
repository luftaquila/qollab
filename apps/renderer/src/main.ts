import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { RenderCache } from "./cache.js";
import { Workers, type Result } from "./workers.js";
const exec = promisify(execFile);
const base = process.env.APP_URL || "http://app:3000",
  secret = process.env.RENDERER_TOKEN;
const image =
  process.env.RENDER_IMAGE || "ghcr.io/luftaquila/qollab-renderer:0.1.6";
const engine = process.env.CONTAINER_ENGINE || "docker",
  namespace = process.env.RENDERER_NAMESPACE || "qollab";
if (!secret || secret.length < 32)
  throw new Error("RENDERER_TOKEN must contain at least 32 characters");
const headers = {
  Authorization: "Bearer " + secret,
  "Content-Type": "application/json",
};
let stopped = false;
const cache = new RenderCache();
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
function workerArgs() {
  return [
    "create",
    "-i",
    "--label",
    `io.qollab.renderer=${namespace}`,
    "--label",
    `io.qollab.job=${randomUUID()}`,
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
}
const workers = new Workers(
  engine,
  workerArgs,
  Number(process.env.RENDER_WARM_MS ?? 30000),
);
async function run(job: any, input: any) {
  const { result, timings } = await workers.run(
    {
      ...input,
      target: job.target,
      timeout: job.timeout,
      cache: cache.get(job.cacheKey),
    },
    job.timeout,
    () =>
      request(`/builds/${job.id}/status`, "GET", undefined, {
        "x-render-lease": job.lease,
      }),
  );
  console.info(
    JSON.stringify({
      type: "render-timing",
      build: job.id,
      ...timings,
      worker: result.metrics,
      succeeded: !!result.pdf,
    }),
  );
  return result;
}
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    stopped = true;
    void workers.stop().finally(() => process.exit(0));
  });
await cleanup();
let activityAt = 0;
while (!stopped) {
  try {
    if (Date.now() - activityAt >= 5000) {
      activityAt = Date.now();
      try {
        workers.keepWarm((await request("/activity")).editing === true);
      } catch {
        workers.keepWarm(false);
      }
    }
    const job = await request("/lease", "POST", {});
    if (job) {
      let result: Result;
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
      const { cache: nextCache, ...output } = result;
      await request(`/builds/${job.id}/result`, "POST", {
        ...output,
        lease: job.lease,
        image,
      });
      cache.set(job.cacheKey, result.pdf ? nextCache : undefined);
      continue;
    }
  } catch (e) {
    console.error(String(e));
  }
  await new Promise((r) => setTimeout(r, workers.warm ? 50 : 1000));
}
