import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export type Result = {
  pdf?: string;
  log: string;
  cache?: unknown;
  metrics?: Record<string, number>;
};
type Worker = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  created: number;
  createMs: number;
  result: Promise<Result>;
  done: boolean;
  assigned: boolean;
  idle?: ReturnType<typeof setTimeout>;
  removing?: Promise<void>;
};

/** Each process receives one document snapshot. The spare has never seen input. */
export class Workers {
  private spare?: Promise<Worker | undefined>;
  private all = new Set<Worker>();
  private stopped = false;
  private keepUntil = 0;
  constructor(
    private engine: string,
    private args: () => string[],
    private warmMs = 30_000,
  ) {
    if (!Number.isFinite(warmMs) || warmMs < 0 || warmMs > 30_000)
      throw new Error("Invalid RENDER_WARM_MS");
  }
  get warm() {
    return !!this.spare;
  }
  /** Renewed only by authenticated editor activity; expires on app failure. */
  keepWarm(editing: boolean) {
    this.keepUntil = editing ? Date.now() + 15_000 : 0;
    if (editing) this.prime();
  }
  private async remove(w: Worker) {
    clearTimeout(w.idle);
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
    let resolve!: (r: Result) => void;
    const result = new Promise<Result>((r) => {
      resolve = r;
    });
    const w: Worker = {
      id: stdout.trim(),
      child,
      created: performance.now(),
      createMs: performance.now() - started,
      result,
      done: false,
      assigned: false,
    };
    this.all.add(w);
    const out: Buffer[] = [];
    let size = 0,
      log = "",
      overflow = false;
    child.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > 72 * 1024 * 1024) {
        overflow = true;
        void this.remove(w);
      } else out.push(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      log = (log + b.toString()).slice(-60000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      w.done = true;
      resolve({ log: String(e) });
    });
    child.on("close", (code) => {
      w.done = true;
      if (overflow) return resolve({ log: "RENDER_OUTPUT_LIMIT" });
      if (code !== 0) return resolve({ log: log || `Renderer exit ${code}` });
      try {
        resolve(JSON.parse(Buffer.concat(out).toString()));
      } catch {
        resolve({ log: "INVALID_RENDER_OUTPUT\n" + log });
      }
    });
    if (this.stopped) await this.remove(w);
    return w;
  }
  private prime() {
    if (this.stopped || !this.warmMs || this.spare) return;
    const pending = this.prepare()
      .then((w) => {
        if (!this.stopped)
          w.idle = setTimeout(() => {
            if (w.assigned) return;
            if (this.spare === pending) this.spare = undefined;
            void this.remove(w).then(() => {
              if (Date.now() < this.keepUntil) this.prime();
            });
          }, this.warmMs);
        return w;
      })
      .catch((e) => {
        if (this.spare === pending) this.spare = undefined;
        console.error(String(e));
        return undefined;
      });
    this.spare = pending;
  }
  async run(input: unknown, timeout: number, status: () => Promise<unknown>) {
    const pending = this.spare;
    this.spare = undefined;
    let w = pending ? await pending : undefined;
    if (
      w &&
      (w.done || w.removing || performance.now() - w.created >= this.warmMs)
    ) {
      await this.remove(w);
      w = undefined;
    }
    w ||= await this.prepare();
    const worker = w;
    if (this.stopped) {
      await this.remove(worker);
      throw new Error("Renderer stopped");
    }
    worker.assigned = true;
    clearTimeout(worker.idle);
    const start = performance.now(),
      warmMs = start - worker.created;
    // Start the next empty worker while this worker performs its only render.
    this.prime();
    let expired = false,
      polling = false,
      cancelled = false;
    const monitor = setInterval(() => {
      if (polling || cancelled) return;
      polling = true;
      void status()
        .catch(() => {
          cancelled = true;
          void this.remove(worker);
        })
        .finally(() => {
          polling = false;
        });
    }, 2000);
    const timer = setTimeout(() => {
      expired = true;
      void this.remove(worker);
    }, timeout * 1000);
    try {
      worker.child.stdin.end(JSON.stringify(input));
      const result = await worker.result;
      return {
        result: expired ? { log: "RENDER_TIMEOUT_OR_OUTPUT_LIMIT" } : result,
        timings: {
          createMs: Math.round(worker.createMs),
          warmMs: Math.round(warmMs),
          executionMs: Math.round(performance.now() - start),
        },
      };
    } finally {
      clearInterval(monitor);
      clearTimeout(timer);
      // The job process has exited. Publish its result while the engine removes
      // the stopped container; stop() still awaits all outstanding removals.
      void this.remove(worker);
    }
  }
  async stop() {
    this.stopped = true;
    this.keepUntil = 0;
    await this.spare;
    this.spare = undefined;
    await Promise.all([...this.all].map((w) => this.remove(w)));
  }
}
