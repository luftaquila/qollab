import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workers, type Job } from "../apps/renderer/src/workers.js";

// A container engine whose workers answer one JSON line per request line and
// record what they receive.
const engineSource = `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';import readline from 'node:readline';
const root=path.dirname(fileURLToPath(import.meta.url));
const [command,...args]=process.argv.slice(2), id=args.at(-1);
const event=(e)=>fs.appendFileSync(path.join(root,'events'),JSON.stringify(e)+'\\n');
if(command==='create'){const id=randomUUID();event({name:'create',id});console.log(id);}
if(command==='rm'){event({name:'remove',id});}
if(command==='start'){event({name:'start',id});
  readline.createInterface({input:process.stdin}).on('line',(line)=>{const r=JSON.parse(line);
    event({name:'input',id,target:r.target,files:r.files.map(f=>f.path),remove:r.remove});
    if(r.target==='hold.qmd')return;
    if(r.target==='reset.qmd'){console.log(JSON.stringify({log:'broken',reset:true}));return;}
    setTimeout(()=>console.log(JSON.stringify({pdf:'JVBERi0=',log:''})),20);});}
`;

it("keeps a worker per project and sends it only what changed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qollab-workers-"));
  const engine = join(dir, "engine.mjs");
  await writeFile(engine, engineSource, { mode: 0o755 });
  const pool = new Workers(engine, () => ["create"], {
    warmMs: 300,
    idleMs: 400,
    maxAgeMs: 60_000,
    max: 1,
  });
  const events = async () =>
    (await readFile(join(dir, "events"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
  const inputs = async () => (await events()).filter((e) => e.name === "input");
  const fetched: string[] = [];
  const blob = async (id: string) => {
    fetched.push(id);
    return Buffer.from("png " + id);
  };
  const job = (project: string, files: Job["files"], extra: Partial<Job> = {}): Job => ({
    project,
    epoch: 1,
    target: "doc.qmd",
    timeout: 3,
    files,
    ...extra,
  });
  const ok = async () => {};
  try {
    const a1 = await pool.run(
      job("A", [
        { path: "doc.qmd", source: "one" },
        { path: "a.png", blob: "b1" },
      ]),
      blob,
      ok,
    );
    expect(a1.result.pdf).toBeTruthy();
    expect(a1.timings.reused).toBe(0);
    // Same worker, only the changed text; the image is not fetched again.
    const a2 = await pool.run(
      job("A", [
        { path: "doc.qmd", source: "two" },
        { path: "a.png", blob: "b1" },
      ]),
      blob,
      ok,
    );
    expect(a2.timings.reused).toBe(1);
    let seen = await inputs();
    expect(seen[1].id).toBe(seen[0].id);
    expect(seen.map((e) => e.files)).toEqual([["doc.qmd", "a.png"], ["doc.qmd"]]);
    expect(fetched).toEqual(["b1"]);
    // A removed file is named; nothing else is sent.
    await pool.run(job("A", [{ path: "doc.qmd", source: "two" }]), blob, ok);
    seen = await inputs();
    expect(seen[2]).toMatchObject({ files: [], remove: ["a.png"] });
    // Another project gets its own worker; with one kept worker, A's goes.
    const b = await pool.run(job("B", [{ path: "doc.qmd", source: "b" }]), blob, ok);
    expect(b.timings.reused).toBe(0);
    seen = await inputs();
    expect(seen[3].id).not.toBe(seen[0].id);
    await expect
      .poll(async () => (await events()).some((e) => e.name === "remove" && e.id === seen[0].id))
      .toBe(true);
    expect(pool.kept).toEqual(["B"]);
    // A new generation (restore) starts over with all files.
    await pool.run(job("B", [{ path: "doc.qmd", source: "b" }], { epoch: 2 }), blob, ok);
    seen = await inputs();
    expect(seen[4].id).not.toBe(seen[3].id);
    expect(seen[4].files).toEqual(["doc.qmd"]);
    // A worker that asks to start over, or does not answer in time, is removed.
    const reset = await pool.run(
      job("B", [{ path: "doc.qmd", source: "c" }], { epoch: 2, target: "reset.qmd" }),
      blob,
      ok,
    );
    expect(reset.result.reset).toBe(true);
    const held = await pool.run(
      job("C", [{ path: "doc.qmd", source: "x" }], { target: "hold.qmd", timeout: 0.1 }),
      blob,
      ok,
    );
    expect(held.result.log).toBe("RENDER_TIMEOUT_OR_OUTPUT_LIMIT");
    await expect.poll(() => pool.kept).toEqual([]);
    // An idle project worker is removed.
    await pool.run(job("D", [{ path: "doc.qmd", source: "d" }]), blob, ok);
    expect(pool.kept).toEqual(["D"]);
    await expect.poll(() => pool.kept, { timeout: 3000 }).toEqual([]);
    // Editor activity keeps an empty spare ready, which never receives input.
    const before = (await inputs()).length;
    pool.keepWarm(true);
    await expect.poll(() => pool.warm).toBe(true);
    pool.keepWarm(false);
    await expect.poll(() => pool.warm, { timeout: 3000 }).toBe(false);
    expect((await inputs()).length).toBe(before);
    await pool.stop();
    const all = await events();
    expect(new Set(all.filter((e) => e.name === "remove").map((e) => e.id))).toEqual(
      new Set(all.filter((e) => e.name === "create").map((e) => e.id)),
    );
  } finally {
    await pool.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
