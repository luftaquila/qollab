import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
const exec = promisify(execFile);
export type Result = {
  pdf?: string;
  log: string;
  metrics?: Record<string, number>;
  /** The worker's files may be half applied: it is not used again. */
  reset?: boolean;
};
export type InputFile = {
  path: string;
  source?: string;
  blob?: string;
  bytes?: string;
};
export type Job = {
  project: string;
  epoch: number;
  target: string;
  timeout: number;
  files: InputFile[];
};
type Worker = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  created: number;
  createMs: number;
  project?: string;
  epoch?: number;
  /** Path → content the worker already has (text hash or blob id). */
  files: Map<string, string>;
  used: number;
  busy: boolean;
  closed: boolean;
  log: string;
  pending: Buffer[];
  waiting?: (line: string | undefined) => void;
  idle?: ReturnType<typeof setTimeout>;
  removing?: Promise<void>;
};
export type Limits = {
  /** An empty spare is replaced after this long. */
  warmMs: number;
  /** A project's worker is removed after this long without builds. */
  idleMs: number;
  /** A worker is replaced after this long (the engine may stop it later). */
  maxAgeMs: number;
  /** Project workers kept at once, besides the spare. */
  max: number;
};
const LINE_LIMIT = 72 * 1024 * 1024;

/**
 * A worker container per project, kept between builds: each build sends only
 * the files that changed, and the worker's `typst watch` lays out only what
 * changed. Workers never see another project's files. An empty spare is kept
 * ready while editors are active, so a project's first build does not wait for
 * a container to start.
 */
export class Workers {
  private spare?: Promise<Worker | undefined>;
  private projects = new Map<string, Worker>();
  private all = new Set<Worker>();
  private stopped = false;
  private keepUntil = 0;
  private limits: Limits;
  constructor(
    private engine: string,
    private args: () => string[],
    limits: Partial<Limits> = {},
  ) {
    this.limits = {
      warmMs: 30_000,
      idleMs: 600_000,
      maxAgeMs: 1_800_000,
      max: 2,
      ...limits,
    };
    const { warmMs, idleMs, maxAgeMs, max } = this.limits;
    if (!Number.isFinite(warmMs) || warmMs < 0 || warmMs > 30_000)
      throw new Error("Invalid RENDER_WARM_MS");
    if (!(idleMs > 0) || !(maxAgeMs > 0) || !(max >= 1))
      throw new Error("Invalid render worker limits");
  }
  get warm() {
    return !!this.spare;
  }
  /** Workers kept for projects (for logs and tests). */
  get kept() {
    return [...this.projects.keys()];
  }
  /** Renewed only by authenticated editor activity; expires on app failure. */
  keepWarm(editing: boolean) {
    this.keepUntil = editing ? Date.now() + 15_000 : 0;
    if (editing) this.prime();
  }
  private async remove(w: Worker) {
    clearTimeout(w.idle);
    if (w.project && this.projects.get(w.project) === w)
      this.projects.delete(w.project);
    if (!w.removing)
      w.removing = exec(this.engine, ["rm", "-f", w.id])
        .catch(() => {})
        .then(() => {
          w.child.kill("SIGTERM");
          this.all.delete(w);
        });
    await w.removing;
  }
  private async prepare(): Promise<Worker> {
    const started = performance.now();
    const { stdout } = await exec(this.engine, this.args());
    const child = spawn(this.engine, ["start", "-ai", stdout.trim()], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const w: Worker = {
      id: stdout.trim(),
      child,
      created: performance.now(),
      createMs: performance.now() - started,
      files: new Map(),
      used: Date.now(),
      busy: false,
      closed: false,
      log: "",
      pending: [],
    };
    this.all.add(w);
    let size = 0;
    child.stdout.on("data", (b: Buffer) => {
      let start = 0;
      for (let i = b.indexOf(10); i >= 0; i = b.indexOf(10, start)) {
        const line = Buffer.concat([...w.pending, b.subarray(start, i)]);
        w.pending = [];
        size = 0;
        start = i + 1;
        const waiting = w.waiting;
        w.waiting = undefined;
        waiting?.(line.toString());
      }
      if (start < b.length) {
        size += b.length - start;
        if (size > LINE_LIMIT) {
          w.pending = [];
          w.log = "RENDER_OUTPUT_LIMIT";
          void this.remove(w);
        } else w.pending.push(b.subarray(start));
      }
    });
    child.stderr.on("data", (b: Buffer) => {
      w.log = (w.log + b.toString()).slice(-60000);
    });
    child.stdin.on("error", () => {});
    const closed = () => {
      w.closed = true;
      const waiting = w.waiting;
      w.waiting = undefined;
      waiting?.(undefined);
    };
    child.on("error", (e) => {
      w.log = String(e);
      closed();
    });
    child.on("close", closed);
    if (this.stopped) await this.remove(w);
    return w;
  }
  private prime() {
    if (this.stopped || !this.limits.warmMs || this.spare) return;
    const pending = this.prepare()
      .then((w) => {
        if (!this.stopped)
          w.idle = setTimeout(() => {
            if (w.project) return;
            if (this.spare === pending) this.spare = undefined;
            void this.remove(w).then(() => {
              if (Date.now() < this.keepUntil) this.prime();
            });
          }, this.limits.warmMs);
        return w;
      })
      .catch((e) => {
        if (this.spare === pending) this.spare = undefined;
        console.error(String(e));
        return undefined;
      });
    this.spare = pending;
  }
  /** The project's worker, or the spare (or a new container) assigned to it. */
  private async assign(job: Job): Promise<{ worker: Worker; reused: boolean }> {
    const kept = this.projects.get(job.project);
    if (kept) {
      const stale =
        kept.closed ||
        kept.removing ||
        kept.epoch !== job.epoch ||
        performance.now() - kept.created >= this.limits.maxAgeMs;
      if (!stale) return { worker: kept, reused: true };
      await this.remove(kept);
    }
    const pending = this.spare;
    this.spare = undefined;
    let w = pending ? await pending : undefined;
    if (
      w &&
      (w.closed || w.removing || performance.now() - w.created >= this.limits.warmMs)
    ) {
      await this.remove(w);
      w = undefined;
    }
    w ||= await this.prepare();
    clearTimeout(w.idle);
    w.project = job.project;
    w.epoch = job.epoch;
    this.projects.set(job.project, w);
    // Fewer kept workers than the limit: the least recently used one goes.
    const idle = [...this.projects.values()]
      .filter((x) => x !== w && !x.busy)
      .sort((a, b) => a.used - b.used);
    while (this.projects.size > this.limits.max && idle.length)
      await this.remove(idle.shift()!);
    return { worker: w, reused: false };
  }
  private read(w: Worker, ms: number) {
    return new Promise<string | undefined>((resolve) => {
      if (w.closed) return resolve(undefined);
      const timer = setTimeout(() => {
        w.waiting = undefined;
        resolve(undefined);
      }, ms);
      w.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }
  /**
   * Renders a build in its project's worker. `blob` fetches an image the
   * worker does not have yet. `status` reports whether the lease still holds.
   */
  async run(
    job: Job,
    blob: (id: string) => Promise<Buffer>,
    status: () => Promise<unknown>,
  ) {
    if (this.stopped) throw new Error("Renderer stopped");
    const { worker, reused } = await this.assign(job);
    worker.busy = true;
    clearTimeout(worker.idle);
    const start = performance.now(),
      warmMs = start - worker.created;
    // Keep an empty container ready for the next project.
    this.prime();
    // A lost lease keeps the worker: the build is short, and its files and
    // layout serve the next build of the project.
    let polling = false;
    const monitor = setInterval(() => {
      if (polling) return;
      polling = true;
      void status()
        .catch(() => {})
        .finally(() => {
          polling = false;
        });
    }, 2000);
    let result: Result;
    try {
      const files: InputFile[] = [],
        sent = new Map<string, string>(),
        present = new Set<string>();
      for (const f of job.files) {
        const key = f.blob
          ? "blob:" + f.blob
          : "text:" +
            createHash("sha256")
              .update(f.bytes ?? f.source ?? "")
              .digest("hex");
        present.add(f.path);
        if (worker.files.get(f.path) === key) continue;
        sent.set(f.path, key);
        if (f.blob)
          files.push({ path: f.path, bytes: (await blob(f.blob)).toString("base64") });
        else if (f.bytes !== undefined) files.push({ path: f.path, bytes: f.bytes });
        else files.push({ path: f.path, source: f.source ?? "" });
      }
      const remove = [...worker.files.keys()].filter((p) => !present.has(p));
      worker.child.stdin.write(
        JSON.stringify({ target: job.target, timeout: job.timeout, files, remove }) + "\n",
      );
      const line = await this.read(worker, job.timeout * 1000 + 5000);
      if (line === undefined) {
        result = {
          log: worker.closed
            ? worker.log || "RENDER_WORKER_EXITED"
            : "RENDER_TIMEOUT_OR_OUTPUT_LIMIT",
          reset: true,
        };
      } else {
        try {
          result = JSON.parse(line);
        } catch {
          result = { log: "INVALID_RENDER_OUTPUT\n" + worker.log, reset: true };
        }
      }
      if (!result.reset) {
        for (const [p, key] of sent) worker.files.set(p, key);
        for (const p of remove) worker.files.delete(p);
      }
    } catch (e) {
      result = { log: String(e), reset: true };
    } finally {
      clearInterval(monitor);
      worker.busy = false;
      worker.used = Date.now();
    }
    if (result.reset || worker.closed) void this.remove(worker);
    else
      worker.idle = setTimeout(() => void this.remove(worker), this.limits.idleMs);
    return {
      result,
      timings: {
        createMs: reused ? 0 : Math.round(worker.createMs),
        warmMs: Math.round(warmMs),
        executionMs: Math.round(performance.now() - start),
        reused: reused ? 1 : 0,
      },
    };
  }
  async stop() {
    this.stopped = true;
    this.keepUntil = 0;
    await this.spare;
    this.spare = undefined;
    await Promise.all([...this.all].map((w) => this.remove(w)));
  }
}
