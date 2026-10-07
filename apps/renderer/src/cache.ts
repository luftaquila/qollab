/** Disposable optimization state; keys come only from authenticated leases. */
export class RenderCache {
  private entries = new Map<
    string,
    { value: unknown; bytes: number; time: number }
  >();
  private size = 0;
  constructor(
    private readonly maxBytes = 16 * 1024 * 1024,
    private readonly ttl = 3_600_000,
  ) {}
  get(key: string) {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    this.size -= e.bytes;
    if (Date.now() - e.time > this.ttl) return undefined;
    this.entries.set(key, e);
    this.size += e.bytes;
    return e.value;
  }
  set(key: string, value: unknown) {
    const previous = this.entries.get(key);
    if (previous) this.size -= previous.bytes;
    this.entries.delete(key);
    if (!/^[a-f0-9]{64}$/.test(key) || !value) return;
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > 1_400_000 || bytes > this.maxBytes) return;
    while (this.size + bytes > this.maxBytes && this.entries.size) {
      const oldest = this.entries.keys().next().value!;
      this.size -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, bytes, time: Date.now() });
    this.size += bytes;
  }
}
