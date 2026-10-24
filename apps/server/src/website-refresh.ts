type Refresh = {
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  again: boolean;
  done?: Promise<void>;
};

/** Coalesce requests without postponing the first one or overlapping a build. */
export class WebsiteRefresh {
  private readonly jobs = new Map<string, Refresh>();
  private stopped = false;
  constructor(
    private readonly update: (id: string) => Promise<boolean>,
    private readonly failed: (error: unknown) => void,
    private readonly delay = 200,
  ) {}
  schedule(id: string) {
    if (this.stopped) return;
    const pending = this.jobs.get(id);
    if (pending) {
      if (pending.running) pending.again = true;
      return;
    }
    const job: Refresh = { running: false, again: false };
    this.jobs.set(id, job);
    job.timer = setTimeout(() => {
      job.timer = undefined;
      job.running = true;
      job.done = (async () => {
        let more = false;
        try {
          more = await this.update(id);
        } catch (error) {
          this.failed(error);
        } finally {
          this.jobs.delete(id);
          if (more || job.again) this.schedule(id);
        }
      })();
    }, this.delay);
    job.timer.unref();
  }
  async close() {
    this.stopped = true;
    for (const job of this.jobs.values()) clearTimeout(job.timer);
    await Promise.all([...this.jobs.values()].map((job) => job.done));
    this.jobs.clear();
  }
}
