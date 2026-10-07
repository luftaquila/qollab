import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { gzipSync, brotliCompressSync } from "node:zlib";
const dir = "apps/web/dist/assets",
  files = await readdir(dir),
  report = {};
for (const type of ["index", "Editor", "Pdf", "pdf.worker"]) {
  const names = files.filter(
    (n) => n.startsWith(type) && /\.(?:js|mjs|css)$/.test(n),
  );
  report[type] = { files: names, raw: 0, gzip: 0, brotli: 0 };
  for (const name of names) {
    const b = await readFile(dir + "/" + name);
    report[type].raw += b.length;
    report[type].gzip += gzipSync(b).length;
    report[type].brotli += brotliCompressSync(b).length;
  }
}
await mkdir("tmp", { recursive: true });
await writeFile("tmp/bundle-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
