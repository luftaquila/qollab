import { expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workers } from "../apps/renderer/src/workers.js";

it("prestarts empty workers, assigns each once and removes idle/expired workers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qollab-workers-"));
  const engine = join(dir, "engine.mjs");
  await writeFile(
    engine,
    `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const [command,...args]=process.argv.slice(2), id=args.at(-1);
const event=(name,id)=>fs.appendFileSync(path.join(root,'events'),JSON.stringify({name,id})+'\\n');
if(command==='create'){const id=randomUUID();event('create',id);console.log(id);}
if(command==='rm'){event('remove',id);}
if(command==='start'){event('start',id);let data='';process.stdin.on('data',b=>data+=b);process.stdin.on('end',()=>{event('input',id);const value=JSON.parse(data);if(value.hold){setInterval(()=>{},1000);return;}setTimeout(()=>console.log(JSON.stringify({pdf:'JVBERi0=',log:''})),50);});}
`,
    { mode: 0o755 },
  );
  const pool = new Workers(engine, () => ["create"], 300);
  const events = async () =>
    (await readFile(join(dir, "events"), "utf8"))
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
  try {
    expect(
      (await pool.run({ document: "A" }, 3, async () => {})).result.pdf,
    ).toBeTruthy();
    await expect
      .poll(
        async () => (await events()).filter((e) => e.name === "start").length,
      )
      .toBe(2);
    expect((await events()).filter((e) => e.name === "input")).toHaveLength(1);
    const second = await pool.run({ document: "B" }, 3, async () => {});
    expect(second.result.pdf).toBeTruthy();
    const inputs = (await events()).filter((e) => e.name === "input");
    expect(new Set(inputs.map((e) => e.id)).size).toBe(2);
    const expired = await pool.run({ hold: true }, 0.1, async () => {});
    expect(expired.result.log).toBe("RENDER_TIMEOUT_OR_OUTPUT_LIMIT");
    await expect.poll(() => pool.warm).toBe(false);
    await pool.stop();
    const all = await events();
    expect(
      new Set(all.filter((e) => e.name === "remove").map((e) => e.id)),
    ).toEqual(new Set(all.filter((e) => e.name === "create").map((e) => e.id)));
  } finally {
    await pool.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
